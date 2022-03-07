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

/* regex */
const searchRegex =
  /^\?(?:[0-9a-z]+(?:(?:<>|<|<=|=|>=|>)[0-9a-z-.*]+)?[&|]?)*$/i;

/* modules and utilities */
const {
  blockReward,
  capitalize,
  projectedSupply,
  round,
  rwdShuffle,
  searchAppend
} = require('./apiUtils');
const DB = require('./dbmysql');
const Server = require('./server');
const BlkScanner = require('./scannerblk');
const MemScanner = require('./scannermem');
const NetScanner = require('./scannernet');
const { createHash } = require('crypto');
const mochimo = require('mochimo');

/* environment configuration */
require('dotenv').config();

// create database pools (rw/ro)
const dbopts = {
  database: process.env.DBNAME || 'mochimo',
  password: process.env.DBPASS || 'password',
  user: process.env.DBUSER || 'mochimo',
  host: process.env.DBHOST || 'localhost',
  port: process.env.DBPORT || 3306
};
const db = new DB({ ...dbopts, port: process.env.DBPORT_RW || dbopts.port });
const dbro = new DB({ ...dbopts, port: process.env.DBPORT_RO || dbopts.port });

// create Server instance
const server = new Server({
  sslcert: process.env.SSLCERT,
  sslkey: process.env.SSLKEY
});

// start scanners
const blkscanner = new BlkScanner({ db, emit: server.stream.bind(server) });
const memscanner = new MemScanner({ db, emit: server.stream.bind(server) });
const netscanner = new NetScanner({ db, emit: server.stream.bind(server) });

/* route configuration */
server.enableRoute({
  method: 'GET',
  path: /^\/$/,
  handler: async (res) => {
    dbro.promise().query(
      "SELECT `MEMBER_HOST` as 'host', `MEMBER_STATE` as 'v'" +
      ' FROM `performance_schema`.`replication_group_members`'
    ).then(([members]) => {
      server.respond(res, {
        status: 'OK',
        members: Array.isArray(members)
          ? members.reduce((acc, { host, v }) => ({ [host]: v, ...acc }), {})
          : members
      }, 200);
    }).catch((error) => server.respond(res, Server.Error(error), 500));
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/balance(?:\/(tag|address)\/([0-9a-f]+))(?:\/)?$/i,
  hint: '[BaseURL]/balance/<"tag"|"address">/<value>',
  hintCheck: /balance|tag|address/gi,
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
  search: searchRegex,
  path: /^\/block(?:\/([0-9]+|0x[0-9a-f]+)?)?(?:\/([a-z]+\/?)?)?$/i,
  hint: '[BaseURL]/block/[bnum]/[blockParam]?[searchParam]=[searchValue]',
  hintCheck: /block|blockchain|bc/gi,
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
    dbro.request('block', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else {
        if (bparam) server.respond(res, results[0][bparam], 200);
        else server.respond(res, [...results], 200);
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
    dbro.request('block', options, (error, results) => {
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
              const { mfee, count } = results[i];
              // process chain data for NORMAL block types
              transactions += Number(count);
              hashesTimes += dT;
              hashes += Math.pow(2, difficulty);
              rewards += blockReward(results[i].bnum) + (BigInt(mfee) * BigInt(count));
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
  search: searchRegex,
  path: /^\/ledger(?:\/(address|tag)\/([0-9a-f]+))?(?:\/)?$/i,
  hint: '[BaseURL]/ledger/[<"address"|"tag">/<value>]?[searchParam]=[searchValue]',
  hintCheck: /ledger|neogen|delta|tag|address/gi,
  handler: async (res, type, address, search) => {
    // apply type and address to search parameters
    if (['tag', 'address'].includes(type)) {
      search = searchAppend(search, `${type}=${address}*`);
    }
    const options = { orderby: '`bnum` DESC', search };
    dbro.request('ledger', options, (error, results) => {
      // process results depending on request
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, [...results], 200);
    });
  }
});
server.enableRoute({
  method: 'GET',
  path: /^\/network(?:\/(?:(active)|peers\/(active|push|start))?)?(?:\/(?:(?=\d+\.\d+\.\d+\.\d+)((?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.?){4}))?)?$/i,
  hint: '[BaseURL]/network/[active/][IPv4] or [BaseURL]/network/peers/<"active"|"push"|"start">',
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
      } else server.respond(res, [...results], 200);
    }
  }
});
server.enableRoute({
  search: searchRegex,
  path: /^\/richlist(?:\/)?$/i,
  hint: '[BaseURL]/richlist?[searchParam]=[searchValue]',
  hintCheck: /richlist|rank|leaderboard/gi,
  handler: async (res, search) => {
    // perform richlist search
    const options = { orderby: '`rank` ASC', limit: 20, search };
    dbro.request('richlist', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, [...results], 200);
    });
  }
});
server.enableRoute({
  search: searchRegex,
  path: /^\/transaction(?:\/(address|tag|txid)\/([0-9a-f]+))?(?:\/)?$/i,
  hint: '[BaseURL]/transaction/[<"address"|"tag"|"txid">/<value>]?[searchParam]=[searchValue]',
  hintCheck: /transaction/gi,
  handler: async (res, param, value, search) => {
    const options = { orderby: '`bnum` DESC', search };
    if (value) {
      // apply length conditioning to value
      value = param === 'tag'
        ? value.length < 24 ? value + '*' : value.slice(0, 24)
        : value.length < 64 ? value + '*' : value.slice(0, 64);
      // derive search type depending on param
      if (!['address', 'tag'].includes(param)) {
        options.search += `&${param}=${value}`;
      } else {
        if (param === 'address') param = 'addr';
        options.union = [
          `?src${param}=${value}`,
          `?dst${param}=${value}`,
          `?chg${param}=${value}`
        ];
      }
    }
    // perform transaction search
    dbro.request('transaction', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, [...results], 200);
    });
  }
});
server.enableStream({
  searchRequired: true,
  search: /^[?]?(?:(?:block|network|transaction)+(?:=|=on)?(?:$|&))+$/i,
  path: /^\/stream(?:\/)?$/,
  hint: '[BaseURL]/stream?<types>',
  hintCheck: /stream|block|network|transaction/gi
}, ['block', 'network', 'transaction']);

/* initialize cleanup crew */
const cleanup = (e, src) => {
  console.log(`\n// GLOBAL CLEANUP: initiated from source(${src})...`);
  db.end();
  dbro.end();
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
