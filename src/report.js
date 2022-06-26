#!/usr/bin/env node
/**
 * report.js; Mochimo API Database Integrity Report Generator
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/* global BigInt */

// monkey-patch BigInt serialization
/* eslint no-extend-native: ["error", { "exceptions": ["BigInt"] }] */
BigInt.prototype.toJSON = function () { return this.toString(); };

/* modules and utilities */
const DB = require('./dbmysql');
const fsp = require('fs').promises;
const mochimo = require('mochimo');
const { asUint64String } = require('./apiUtils');

/* environment configuration */
require('dotenv').config();
// create database pools (rw/ro)
const dbro = new DB({
  database: process.env.DBNAME || 'mochimo',
  password: process.env.DBPASS || 'password',
  user: process.env.DBUSER || 'mochimo',
  host: process.env.DBHOST || 'localhost',
  port: process.env.DBPORT_RO || process.env.DBPORT || 3306
});

const { NORMAL } = mochimo.Block;
(async function () {
  const PEERS = [
    'deu-api.mochimap.com',
    'sgp-api.mochimap.com',
    'usc-api.mochimap.com',
    'use-api.mochimap.com',
    'usw-api.mochimap.com'
  ];
  console.log();
  console.log('Acquiring latest Tfile:');
  while (PEERS.length) {
    try {
      const peer = PEERS.shift();
      console.log(`Trying ${peer}...`);
      return await mochimo.getTfile(peer);
    } catch (_ignore) { }
  }
  console.error('Failed to acquire Tfile, exiting...');
  process.exit(1);
})().then(async (TFILE) => {
  const COUNT = TFILE.byteLength / mochimo.BlockTrailer.length;
  const Missing = {
    transactions: [],
    blocks: []
  };
  console.log({ COUNT, Bytes: TFILE.byteLength });
  console.log();

  console.log('Scanning database...');
  for (let i = 0; i < COUNT; i++) {
    process.stdout.write(`Progress: ${i}/${COUNT} (${parseInt(100 * i / COUNT)}%)\r`);
    let { bnum, bhash } = TFILE.trailer(i);
    bnum = bnum.toString();
    await dbro.promise().query({
      sql: 'SELECT * FROM block WHERE ' +
        `bnum = "${bnum}" AND bhash = "${bhash}"`
    }).then(async ([[block]]) => {
      if (!block) return Missing.blocks.push({ bnum, bhash, num: 1 });
      // check transactions
      if (block.type === NORMAL) {
        await dbro.promise().query({
          sql: 'SELECT count(*) FROM transaction WHERE ' +
            `bnum = "${bnum}" and bhash = "${bhash}"`,
          rowsAsArray: true
        }).then(([[tcount]]) => {
          let { count } = block;
          count = count.toString();
          tcount = tcount.toString();
          if (count !== tcount) {
            Missing.transactions.push({
              bnum, bhash, num: Number(count) - Number(tcount)
            });
          }
        }).catch(console.trace);
      }
    }).catch(console.trace);
  }
  return Missing;
}).then((Missing) => {
  console.log();
  console.log('Final counts...');
  // count missing items
  console.log(`Blocks missing: ${
    Missing.blocks.reduce((acc, el) => (acc + el.num), 0)
  }`);
  console.log(`Transactions missing: ${
    Missing.transactions.reduce((acc, el) => (acc + el.num), 0)
  }`);
  console.log();
  console.log('Building final report...');
  const MissingBlocks = Missing.blocks.reduce((acc, blk) => {
    return acc + 'Missing block file ' +
      `b${asUint64String(blk.bnum)}x${blk.bhash.slice(0, 8)}.bc\n`;
  }, '');
  const MissingTxs = Missing.transactions.reduce((acc, tx) => {
    return acc + `Missing ${tx.num} txs from ` +
      `b${asUint64String(tx.bnum)}x${tx.bhash.slice(0, 8)}.bc\n`;
  }, '');
  console.log();
  console.log('Missing data...', '\n', MissingBlocks, '\n', MissingTxs);
  console.log();
  console.log('Writing report to report.txt...');
  return fsp.writeFile('./report.txt', MissingBlocks + MissingTxs);
}).catch(console.trace).finally(() => {
  process.exit();
});
