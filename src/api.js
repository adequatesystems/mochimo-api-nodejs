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
const dbstats = {};
const dbscan = () => {
  // periodic scan of (accurate) table stats
  setTimeout(dbscan, 3600000); // hourly
  dbro.promise().query({
    sql: 'SELECT count(*) FROM `richlist` UNION ' +
      'SELECT count(*) FROM `ledger` UNION ' +
      'SELECT count(*) FROM `block` UNION ' +
      'SELECT count(*) FROM `transaction`',
    rowsAsArray: true
  }).then((result) => {
    const [[[addresses], [deltas], [blocks], [transactions]]] = result;
    Object.assign(dbstats, { addresses, deltas, blocks, transactions });
  }).catch(console.error);
}; // initial scan starts after 30 seconds
setTimeout(dbscan, 30000);

// create Server instance
const server = new Server({
  sslcert: process.env.SSLCERT,
  sslkey: process.env.SSLKEY
});

// start scanners
const blkscanner = new BlkScanner({
  db, emit: server.stream.bind(server), target: process.env.TARGET_BC });
const memscanner = new MemScanner({
  db, emit: server.stream.bind(server), target: process.env.TARGET_MEM });
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
        stats: dbstats,
        members: Array.isArray(members)
          ? members.reduce((acc, { host, v }) => ({ [host]: v, ...acc }), {})
          : members
      }, 200);
    }).catch((error) => {
      // try Percona XtraDB Cluster status
      dbro.promise().query(
        "SHOW STATUS LIKE 'wsrep_cluster_status'"
      ).then(([status]) => {
        server.respond(res, {
          status: Array.isArray(status) ? status[0]?.Value : status,
          stats: dbstats
        }, 200);
      }).catch((error) => server.respond(res, {
        message: "Unable to determine API status..."
      }, 500))
    });
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
  path: /^\/block(?:\/([0-9]{1,20}|0x[0-9a-f]{1,16}){1}(?:\/([0-9a-f]{1,64}){1})?)?(?:\/)?$/i,
  hint: '[BaseURL]/block/[bnum]/[bhash]?[searchParam]=[searchValue]',
  hintCheck: /block|blockchain|bc/gi,
  handler: async (res, bnum, bhash, search) => {
    // add bnum and/or bhash to search
    if (bnum) search = searchAppend(search, `bnum=${Number(bnum)}`);
    if (bhash) search = searchAppend(search, `bhash=${bhash}`);
    // perform block search
    const options = { orderby: '`bnum` DESC', search };
    dbro.request('block', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else server.respond(res, [...results], 200);
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
    if (bnum) bnum = Number(bnum);
    if (bnum) search = searchAppend(search, `bnum<=${Number(bnum)}`);
    // perform initial block search
    const options = { limit: 768, orderby: '`bnum` DESC', search };
    dbro.request('block', options, (error, results) => {
      if (error) server.respond(res, Server.Error(error), 500);
      else if (!results.length || (bnum && results[0].bnum !== bnum)) {
        server.respond(res, { message: 'Block unavailable...' });
      } else {
        const block = results[0];
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
            // process chain data for non-(NEO)GENSIS block types
            difficulties += results[i].difficulty;
            blockTimes += results[i].time;
            nonNeogenesis++;
            if (results[i].type === mochimo.Block.NORMAL) {
              const { mfee, count } = results[i];
              // process chain data for NORMAL block types
              transactions += Number(count);
              hashesTimes += results[i].time;
              hashes += Math.pow(2, results[i].difficulty);
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
        const isNormal = block.type === mochimo.Block.NORMAL;
        const hashrate = round(Math.pow(2, block.difficulty) / block.time);
        const numberReward = Number(blockReward(block.bnum));
        // reconstruct chain data
        const chain = {
          created: block.created,
          started: block.started,
          bhash: block.bhash,
          phash: block.phash,
          mroot: block.mroot,
          nonce: block.nonce,
          haiku: block.nonce ? mochimo.Trigg.expand(block.nonce) : null,
          bnum: block.bnum,
          blocktime: block.time,
          blocktime_avg: round(blockTimes / nonNeogenesis),
          difficulty: block.difficulty,
          difficulty_avg: round(difficulties / nonNeogenesis),
          hashrate: isNormal ? hashrate : null,
          hashrate_avg: round(hashes / hashesTimes),
          pseudorate_avg: round(pseudorate / nonNeogenesis),
          tcount: isNormal ? block.count : null,
          tcount_avg: round(transactions / nonNeogenesis),
          tcountpsec: isNormal ? round(block.count / block.time) : null,
          tcountpsec_avg: round(transactions / blockTimes),
          mfee: block.mfee,
          txfees: isNormal ? (block.count * block.mfee) / 1e+9 : null,
          reward: isNormal ? numberReward / 1e+9 : null,
          mreward: isNormal
            ? ((block.count * block.mfee) + numberReward) / 1e+9
            : null,
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
