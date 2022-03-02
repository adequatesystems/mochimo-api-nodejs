#!/usr/bin/env node
/**
 * importblk.js; Mochimo API Blockchain Importer
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/* global BigInt */

// monkey-patch BigInt serialization
/* eslint no-extend-native: ["error", { "exceptions": ["BigInt"] }] */
BigInt.prototype.toJSON = function () { return this.toString(); };

/* modules and utilities */
const DB = require('./dbmysql');
const BlockScanner = require('./scannerblk');
const { argv } = process;

/* environment configuration */
require('dotenv').config();
// create database pools (rw/ro)
const db = new DB({
  database: process.env.DBNAME || 'mochimo',
  password: process.env.DBPASS || 'password',
  user: process.env.DBUSER || 'mochimo',
  host: process.env.DBHOST || 'localhost',
  port: process.env.DBPORT_RW || process.env.DBPORT || 3306
});

if (argv.length < 3) {
  console.error('missing import directory argument, exiting...');
  process.exit(1);
}

const blkimporter = new BlockScanner({
  db,
  connectionLimit: 100,
  target: argv[2],
  emit: (json) => {
    console.log('Block#', json.bnum, 'accepted');
  }
});

const cleanup = (e, src) => {
  console.log(`\n// GLOBAL CLEANUP: initiated from source(${src})...`);
  blkimporter.cleanup.bind(blkimporter);
  db.end(() => {
    console.log('// GLOBAL CLEANUP: exiting...');
    process.exit(Number(e) || 1);
  });
};

/* configure cleanup crew */
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
