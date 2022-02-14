#!/usr/bin/env node
/**
 * api.js; Mochimo Cryptocurrency Network API
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/* global BigInt */

// monkey-patch BigInt serialization
/* eslint no-extend-native: ["error", { "exceptions": ["BigInt"] }] */
BigInt.prototype.toJSON = function () { return this.toString(); };

console.log('\n// START: ' + __filename);

const capitalize = (s) => s.length ? s[0].toUpperCase() + s.slice(1) : '';
const searchAppend = (search, str) => (search ? search + '&' : '?') + str;
const rwdShuffle = (array, maxItems = 16) => {
  // in-place destructive shuffling algo, reverse widening deletion
  let b = 0;
  const bf = Math.floor(Math.cbrt(array.length)) || 1;
  while (array.length > maxItems) {
    const u = array.length - 1; // upper bound
    const l = Math.max(0, u - ((b++) / bf)); // lower bound
    const r = Math.floor(Math.random() * (u - l + 1) + l); // bound rng
    array.splice(r, 1); // remove selected index
  }
  // return array for convenience
  return array;
};

/* regex */
const regexParams = /^[?]?(?:[0-9a-z]+(?:(?:<>|<=|>=|<|>|=)[0-9a-z-.*]+)?[&|]?)*$/i;
const regexKeyValue = /^([0-9a-z]+)(?:(<>|<=|>=|<|>|=)([0-9a-z-.*]+))?$/i;

/* modules and utilities */
const { blockReward, projectedSupply, round } = require('./apiUtils');
const Server = require('./server');
const BlkScanner = require('./scannerblk');
const MemScanner = require('./scannermem');
const NetScanner = require('./scannernet');
const { createHash } = require('crypto');
const mochimo = require('mochimo');
const mysql2 = require('mysql2');

/* environment configuration */
require('dotenv').config();

/* database configuration */
const mysql = {
  rw: mysql2.createPool({
    database: process.env.DBNAME || 'mochimo',
    password: process.env.DBPASS || 'password',
    user: process.env.DBUSER || 'mochimo',
    host: process.env.DBHOST || 'localhost',
    port: process.env.DBPORT_RW || process.env.DBPORT || 3306,
    waitForConnections: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z'
  }),
  ro: mysql2.createPool({
    database: process.env.DBNAME || 'mochimo',
    password: process.env.DBPASS || 'password',
    user: process.env.DBUSER || 'mochimo',
    host: process.env.DBHOST || 'localhost',
    port: process.env.DBPORT_RO || process.env.DBPORT || 3306,
    waitForConnections: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z'
  }),
  query: (table, options, callback) => {
    let { limit, offset, orderby, search, select } = options;
    let nConditions = 0;
    let where = '';
    // consume search and place in `where`
    while (search) {
      const nextbrkp = search.slice(1).search(/[?&|]/g) + 1;
      const condition = nextbrkp
        ? search.slice(1, nextbrkp)
        : search.slice(1);
      // check condition
      if (condition) {
        const matched = condition.match(regexKeyValue);
        if (matched) {
          // drop match
          matched.shift();
          let [column, comparitor, value] = matched;
          // check for "special" parameters
          if (value) {
            switch (column) {
              case 'limit':
                // cleanse limit value
                limit = isNaN(value) ? 10 : Number(value);
                if (limit > 100) limit = 100;
                if (limit < 0) limit = 0;
                break;
              case 'offset':
                // cleanse offset value
                offset = isNaN(value) ? 0 : Number(value);
                if (offset < 0) offset = 0;
                break;
              default:
                if (value.includes('*')) {
                  value = value.replace(/[*]/g, '%');
                  if (comparitor === '<>') comparitor = 'NOT LIKE';
                  else if (comparitor === '=') comparitor = 'LIKE';
                }
                // apply condition extension and modified condition
                if (nConditions++) {
                  if (search.charAt(0) === '&') where += ' AND ';
                  if (search.charAt(0) === '|') where += ' OR ';
                }
                where += `\`${column}\` ${comparitor} '${value}'`;
            }
          }
        }
      }
      // reduce search for next round
      search = nextbrkp ? search.slice(nextbrkp) : '';
    }
    // perform restricted query
    mysql.ro.query(`
      SELECT ${
        Array.isArray(select) ? select.join(', ') : (select || '*')}
      from \`${table}\`
      ${where ? `WHERE ${where}` : ''}
      ${orderby ? `ORDER BY ${orderby}` : ''}
      ${limit ? `LIMIT ${limit}` : 'LIMIT 10'}
      ${offset ? `OFFSET ${offset}` : ''}
    `, callback);
  }
};

// create Server instance
const server = new Server({
  secure: Boolean(process.env.SSLCERT && process.env.SSLKEY),
  sslCert: process.env.SSLCERT,
  sslkey: process.env.SSLKEY
});

// start scanners
const blkscanner = new BlkScanner({
  db: mysql.rw, emit: server.streamEmit.bind(server)
});
const memscanner = new MemScanner({
  db: mysql.rw, emit: server.streamEmit.bind(server)
});
const netscanner = new NetScanner({
  db: mysql.rw, emit: server.streamEmit.bind(server)
});

/* route configuration */
server.enableRoute({
  method: 'GET',
  path: /^\/$/,
  handler: async (res) => server.respond(res, 'OK', 200)
});
server.enableRoute({
  method: 'GET',
  path: /^\/balance\/neogen(?:\/(address|tag)\/([0-9a-f]+))?(?:\/)?$/i,
  param: regexParams,
  hint: '[BaseURL]/balance/neogen/[<address|tag>/<addressParameter>]',
  hintCheck: /balance|neogen|delta|tag|address/gi,
  handler: async (res, type, address, search) => {
    // apply type and address to search parameters
    if (['tag', 'address'].includes(type)) {
      search = searchAppend(search, `${type}=${address}*`);
    }
    const options = { orderby: '`bnum` DESC', search };
    mysql.query('balance', options, (error, results) => {
      // process results depending on request
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, { results }, 200);
    });
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/balance(?:\/(tag|address)\/([0-9a-f]+))(?:\/)?$/i,
  hint: '[BaseURL]/balance/<tag|address>/<addressParameter>',
  hintCheck: /balance|ledger|delta|tag|address/gi,
  handler: async (res, type, address) => {
    // perform balance request
    const isTag = Boolean(type === 'tag');
    const typeStr = isTag ? 'tag' : 'wots+';
    // get list of best peers to use for balance request
    const peers = rwdShuffle(netscanner.getPeers({ status: mochimo.VEOK }));
    const consensus = await new Promise((resolve) => {
      let done = 0;
      const results = [];
      if (!peers.length) resolve(false);
      peers.forEach((peer) => {
        mochimo.getBalance(peer.ip, address, isTag).then((le) => {
          const result = results.find((res) => res.le.balance === le.balance);
          if (result && ++result.consensus >= 3) resolve(result.le);
          else if (!result) {
            results.push({
              le: {
                address: le.address,
                addressHash: '',
                tag: le.tag,
                balance: le.balance
              },
              consensus: 0
            });
          }
        }).catch((timeout) => { /* ignore */ }).finally(() => {
          if (++done >= peers.length) {
            if (!results.length) resolve(false);
            else resolve({ warning: 'consensus low', ...results[0].le });
          }
        });
      });
    });
    if (!consensus) {
      server.respond(res, { message: `${typeStr} not found in ledger...` });
    } else {
      consensus.addressHash = createHash('sha256')
        .update(Buffer.from(consensus.address, 'hex')).digest('hex');
      server.respond(res, consensus, 200);
    }
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/block(?:\/([0-9]+|0x[0-9a-f]+)?)?(?:\/([a-z]+\/?)?)?$/i,
  param: regexParams,
  hint: '[BaseURL]/block/[bnum]/[blockParam]',
  hintCheck: /block|bc/gi,
  handler: async (res, bnum, bparam, search) => {
    const validParams = [
      'created', 'started', 'type', 'size', 'difficulty', 'bnum',
      'bhash', 'phash', 'mroot', 'nonce', 'maddr', 'mreward',
      'mfee', 'amount', 'tcount', 'lcount'
    ];
    if (bparam) {
      if (!validParams.includes(bparam)) {
        return server.respond(res, {
          message: `The block data does not contain '${bparam}'...`
        });
      }
    }
    // apply bnum to search
    if (bnum) search = searchAppend(search, `bnum=${Number(bnum)}`);
    // perform block search
    const options = { orderby: '`bnum` DESC', search };
    mysql.query('block', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else {
        if (bparam) server.respond(res, results[0][bparam], 200);
        else server.respond(res, { results }, 200);
      }
    });
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/chain(?:\/([0-9]+|0x[0-9a-f]+)?)?(?:\/([a-z]+\/?)?)?$/i,
  hint: '[BaseURL]/chain/[bnum]/[chainParam]',
  hintCheck: /chain|bc/gi,
  handler: async (res, bnum, cparam) => {
    const validParams = [
      'circsupply', 'totalsupply', 'maxsupply', 'bhash', 'phash', 'mroot',
      'nonce', 'haiku', 'bnum', 'mfee', 'time0', 'stime', 'blocktime',
      'blocktime_avg', 'tcount', 'tcount_avg', 'tcountpsec',
      'tcountpsec_avg', 'txfees', 'reward', 'mreward', 'difficulty',
      'difficulty_avg', 'hashrate', 'hashrate_avg', 'pseudorate_avg'
    ];
    if (cparam) {
      if (!validParams.includes(cparam)) {
        return server.respond(res, {
          message: `The chain data does not contain '${cparam}'...`
        });
      }
    }
    // apply bnum to search
    let search = '';
    if (bnum) search = searchAppend(search, `bnum<=${Number(bnum)}`);
    // perform initial block search
    const options = { limit: 768, orderby: '`bnum` DESC', search };
    mysql.query('block', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else if (!results.length) {
        server.respond(res, { message: 'Blocks not yet available...' });
      } else {
        bnum = results[0].bnum;
        // deconstruct trailers and perform chain calculations
        let lostsupply, totalsupply, circsupply;
        let rewards = 0n;
        let pseudorate = 0;
        let nonNeogenesis = 0;
        let transactions = 0;
        let blockTimes = 0;
        let hashesTimes = 0;
        let hashes = 0;
        let difficulties = 0;
        let phash;
        for (let i = 0; i < results.length; i++) {
          if (phash && phash !== results[i].bhash) continue;
          phash = results[i].phash;
          if (results[i].type !== mochimo.Block.NEOGENESIS) {
            const { difficulty, created, started } = results[i];
            // process chain data for non-(NEO)GENSIS block types
            const stime = Number(new Date(created)) / 1000 | 0;
            const time0 = Number(new Date(started)) / 1000 | 0;
            const dT = stime - time0;
            difficulties += difficulty;
            blockTimes += dT;
            nonNeogenesis++;
            if (results[i].type === mochimo.Block.NORMAL) {
              const { mfee, tcount } = results[i];
              // process chain data for NORMAL block types
              transactions += Number(tcount);
              hashesTimes += dT;
              hashes += Math.pow(2, difficulty);
              rewards += blockReward(results[i].bnum) + (BigInt(mfee) * BigInt(tcount));
            } else pseudorate++; // count PSEUDO block types
          } else if (!totalsupply) {
            // process first (ONLY) (NEO)GENSIS block type
            totalsupply = BigInt(results[i].amount) + rewards;
            // calculate lost supply and subtract from max supply
            lostsupply = projectedSupply(results[i].bnum) - totalsupply;
            circsupply = projectedSupply(results[i].bnum, 1) - lostsupply;
          }
        }
        const isNeogenesis = results[0].type === mochimo.Block.NEOGENESIS;
        const isNormal = results[0].type === mochimo.Block.NORMAL;
        const blocktime = (((new Date(results[0].created)) -
          (new Date(results[0].started))) / 1000) | 0;
        const hashrate = round(Math.pow(2, results[0].difficulty) / blocktime);
        // reconstruct chain data
        const block = results[0];
        const chain = {
          created: block.created,
          started: block.started,
          bhash: block.bhash,
          phash: block.phash,
          mroot: block.mroot,
          nonce: block.nonce,
          haiku: block.nonce ? mochimo.Trigg.expand(block.nonce) : null,
          bnum: block.bnum,
          blocktime: blocktime,
          blocktime_avg: round(blockTimes / nonNeogenesis),
          difficulty: block.difficulty,
          difficulty_avg: round(difficulties / nonNeogenesis),
          hashrate: isNormal ? hashrate : null,
          hashrate_avg: round(hashes / hashesTimes),
          pseudorate_avg: round(pseudorate / nonNeogenesis),
          tcount: block.tcount,
          tcount_avg: round(transactions / nonNeogenesis),
          tcountpsec: isNeogenesis ? null : round(block.tcount / blocktime),
          tcountpsec_avg: round(transactions / blockTimes),
          mfee: block.mfee,
          txfees: (block.tcount * block.mfee) / 1e+9,
          reward: isNeogenesis ? null : Number(blockReward(bnum)) / 1e+9,
          mreward: ((block.tcount * block.mfee) / 1e+9) +
            (isNeogenesis ? null : Number(blockReward(bnum)) / 1e+9),
          circsupply: Number(circsupply) / 1e+9,
          totalsupply: Number(totalsupply) / 1e+9,
          maxsupply: Number(projectedSupply()) / 1e+9
        };
        if (cparam) server.respond(res, chain[cparam], 200);
        else server.respond(res, chain, 200);
      }
    });
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/network(?:\/(?:(active)|peers\/(active|push|start))?)?(?:\/(?:(?=\d+\.\d+\.\d+\.\d+)((?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.?){4}))?)?$/i,
  hint: '[BaseURL]/network[/active[/IPv4]||peers</active||push||start>]',
  hintCheck: /network|active|peers|push|start/gi,
  handler: (res, status, listType, ip) => {
    const start = Date.now();
    const peerOptions = {};
    if (status === 'active' || listType) peerOptions.status = mochimo.VEOK;
    if (ip) peerOptions.ip = ip;
    let results = netscanner.getPeers(peerOptions);
    // handle results appropriately
    if (listType) {
      if (listType === 'push') {
        results = results.filter((peer) => peer.cbits & mochimo.C_PUSH);
      }
      const found = results.length;
      if (listType !== 'active' && results.length) rwdShuffle(results);
      // build peerlist content
      let content = `# Mochimo ${capitalize(listType)} Peerlist, `;
      content += `built on ${new Date()}\n# Build; `;
      content += `time= ${Date.now() - start}ms, peers= ${found}, `;
      content += `height= ${results[0] && results[0].cblock}, `;
      content += `weight= 0x${results[0] && results[0].weight}\n`;
      results.forEach((peer) => { content += `${peer.ip}\n`; });
      server.respond(res, content, 200);
    } else {
      if (!results.length) {
        server.respond(res, {
          message: 'Nothing found matching request'
        });
      } else server.respond(res, { found: results.length, results }, 200);
    }
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/richlist(?:\/)?$/i,
  param: regexParams,
  hint: '[BaseURL]/richlist',
  hintCheck: /richlist|rank|leaderboard/gi,
  handler: async (res, search) => {
    // perform richlist search
    const options = { orderby: '`rank` ASC', search };
    mysql.query('richlist', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, { results }, 200);
    });
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/transaction(?:\/([0-9a-f]+)?)?$/i,
  param: regexParams,
  hint: '[BaseURL]/transaction/[txid]?[searchParameter]=[searchValue]',
  hintCheck: /transaction/gi,
  handler: async (res, txid, search) => {
    // apply txid to search parameters
    if (txid) search = (search ? search + '&' : '?') + `txid=${txid}*`;
    // perform transaction search
    const options = { orderby: '`created` DESC', search };
    mysql.query('transaction', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, { results }, 200);
    });
  }
});
server.enableStream({
  path: /^\/stream(?:\/)?$/,
  param: /^[?]?(?:(?:block|network|transaction)+(?:=|=on)?(?:$|&))+$/i,
  paramsRequired: true,
  hint: '[BaseURL]/stream<?streamTypes>',
  hintCheck: /stream|block|network|transaction/gi
}, ['block', 'network', 'transaction']);

/* initialize cleanup crew */
const cleanup = (e, src) => {
  console.log(`\n// GLOBAL CLEANUP: initiated from source(${src})...`);
  server.cleanup()
    .then(blkscanner.cleanup.bind(blkscanner))
    .then(memscanner.cleanup.bind(memscanner))
    .then(netscanner.cleanup.bind(netscanner))
    .then(() => process.exit(Number(e) || 0))
    .catch(console.trace).finally(() => {
      console.log('// GLOBAL CLEANUP: failed to exit gracefully...');
      console.log('// GLOBAL CLEANUP: forcing exit...');
      process.exit(Number(e) || 1);
    });
};

/* configure cleanup crew */
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
