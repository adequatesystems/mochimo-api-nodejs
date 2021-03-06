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

const options = argv.length > 2 ? JSON.parse(argv[2]) : {};
const connectionLimit = options.connectionLimit || 100;
const scanOnly = options.scanOnly || true;
const target = options.target || 'archive';
const verbose = options.verbose || true;

const blkimporter = new BlockScanner({
  db, connectionLimit, scanOnly, target, verbose
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
