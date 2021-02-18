#!/usr/bin/env node
/**
 *  MochiMap   Realtime network analysis for the Mochimo Cryptocurrency Network
 *  Copyright (C) 2021  Chrisdigity
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published
 *  by the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 */

/* global BigInt */
/* eslint no-extend-native: ["error", { "exceptions": ["BigInt"] }] */
BigInt.prototype.toJSON = function () { return this.toString(); };

/* requirements */
require('dotenv').config();
const querystring = require('querystring');
// const crypto = require('crypto');
const { isIPv4 } = require('net');
const https = require('https');
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
/* dependancies */
const Archive = require('./mochimap.archive'); // Proprietary Archive storage...
const Utility = require('./mochimap.util'); // Utility functions
const Mochimo = require('mochimo');
const SocketIO = require('socket.io')();

/* pre-core */
// const GENESIS_HASH =
//   '00170c6711b9dc3ca746c46cc281bc69e303dfad2f333ba397ba061eccefde03';
const SET_LIMIT = 0xff;
const Timers = [];

/* core */
const Block = {
  cache: new Set(), // TODO: custom Map() cache
  chain: new Map(),
  check: async (peer, bnum, bhash, checkback) => {
    // check recent blockchain
    if (!Block.cache.has(bhash)) {
      // add bhash to recent
      Block.cache.add(bhash);
      // manage recent list
      if (Block.cache.size > SET_LIMIT) {
        Block.cache.delete(Block.cache.values().next().value);
      }
      // check archive only if check is an extension of a block update
      let stored = 0;
      if (checkback) {
        // check database for bnum/bhash
        stored = (await Archive.search.bc(Archive.file.bc(bnum, bhash))).length;
      }
      if (!stored) {
        // download block and perform block update procedure
        Block.dl(peer, bnum, bhash).then(Block.update).catch(console.error);
      }
    }
  }, /*
  contention: (block) => {

  }, */
  dl: async (peer, bnum, bhash) => {
    // download block from advertising peer
    const block = await Mochimo.getBlock(peer, bnum);
    // check block is as advertised
    if (block.bnum !== bnum) {
      throw Error(`req'd block ${bnum} from ${peer}, got ${bnum}`);
    } else if (block.bhash !== bhash) {
      throw Error(`req'd block ${bnum}/${bhash.slice(0, 8)}~ from ${peer}, ` +
                  `got ${block.bnum}/${block.bhash.slice(0, 8)}~`);
    } else if (block.type === Mochimo.Block.INVALID) {
      throw Error(`req'd block ${bnum}/${bhash.slice(0, 8)}~ from ${peer}, ` +
                  'got invalid');
    }
    // initiate check for any previous blocks
    Block.check(peer, block.bnum - 1n, block.phash, true);
    // return block data for chaining
    return block;
  },
  update: async (block) => {
    // store block properties accessed often
    const bnum = block.bnum;
    const bhash = block.bhash;
    // archive block update
    const writebc = {};
    const fnamebc = Archive.file.bc(bnum, bhash);
    writebc[fnamebc] = Buffer.from(block.buffer);
    Archive.write.bc(writebc); // async
    // archive block summary
    const writebs = {};
    const fnamebs = Archive.file.bs(bnum, bhash);
    const bsummary = Utility.summarizeBlock(block);
    writebs[fnamebs] = JSON.stringify(bsummary);
    Archive.write.bs(writebs); // async
    // broadcast initial block summary as block update
    Server.broadcast('blockUpdates', 'latestBlock', bsummary);
    // find appropriate block to use for haiku visualization
    let hBlock = bsummary;
    let checkback = 0;
    let shadow = 0;
    while (hBlock.type !== 'normal' || checkback > 0) {
      shadow |= checkback;
      if (hBlock.type === 'normal') checkback--; // decrease checkback
      else {
        checkback++; // increase checkback
        // check for previous block summary
        const tempbnum = BigInt(hBlock.bnum);
        const prev = Archive.file.bs(tempbnum - 1n, hBlock.phash);
        if ((await Archive.search.bs(prev)).includes(prev)) {
          // read previous block summary and start over
          hBlock = await Archive.read.bs(prev);
          continue;
        } else {
          // cannot determine appropriate block at this time
          hBlock = null;
          break;
        }
      }
    }
    // visualize Haiku from appropriate block summary
    if (hBlock) {
      shadow = Boolean(shadow);
      const haiku = Mochimo.Trigg.expand(hBlock.nonce, shadow);
      Utility.visualizeHaiku(haiku, https).then(data => {
        // add block data
        data.num = bnum;
        data.shadow = shadow;
        data.str = haiku;
        // broadcast haiku update
        Server.broadcast('haikuUpdates', 'haiku', data);
        // archive haiku visualization
        const writehk = {};
        const fnamehk = Archive.file.hk(bnum, bhash);
        writehk[fnamehk] = JSON.stringify(data);
        Archive.write.hk(writehk); // async
      }).catch(console.trace);
    } else console.log('cannot visualize Haiku for bnum', bnum, 'at this time');
    // handle block deconstruction (performance untested with large blocks)
    const transactions = block.transactions;
    if (transactions) {
      const writetx = {};
      const writety = {};
      transactions.forEach(txe => {
        // build tx filedata
        let fname = Archive.file.tx(txe.txid, bnum, bhash);
        writetx[fname] = Buffer.from(txe.toReference().buffer);
        // build ty files
        let addr = txe.srctag || txe.srcaddr;
        fname = Archive.file.ty(addr, bnum, bhash, txe.txid, 'src');
        writety[fname] = null;
        addr = txe.dsttag || txe.dstaddr;
        fname = Archive.file.ty(addr, bnum, bhash, txe.txid, 'dst');
        writety[fname] = null;
        addr = txe.chgtag || txe.chgaddr;
        fname = Archive.file.ty(addr, bnum, bhash, txe.txid, 'chg');
        writety[fname] = null;
      });
      Archive.write.tx(writetx);
      Archive.write.ty(writety);
    }
    /*
    // handle chain update
    if (Block.chain.has(bnum)) Block.contention(block);
    else Block.chain.set(bnum, block.trailer);
    */
    // return block data for promise chaining
    return block;
  }
}; // end const Block...
const Network = {
  interval: 1000,
  fallback: [
    'https://mochimo.org/startnodes.lst',
    'https://www.mochimap.net/startnodes.lst',
    './startnodes.lst',
    './networkdata.json'
  ],
  map: new Map(),
  getConsensus: () => {
    const chains = new Map();
    let consensus = null;
    Network.map.forEach(node => {
      // ensure node meets requirements
      if (!node.cblockhash) return;
      // increment consensus for chain
      if (chains.has(node.cblockhash)) {
        chains.set(node.cblockhash, chains.get(node.cblockhash) + 1);
      } else chains.set(node.cblockhash, 1);
      // determine consensus
      if (!consensus || chains.get(node.cblockhash) > chains.get(consensus)) {
        consensus = { bnum: node.cblock, bhash: node.cblockhash };
      }
    });
    return consensus;
  },
  parse: (data, jsonType) => {
    // read *.json type data directly, else assume peerlist
    if (jsonType) {
      Object.entries(data).forEach(([ip, node]) => {
        if (isIPv4(ip)) Network.map.set(ip, node);
      });
    } else {
      (data.match(/(^|(?<=\n))[\w.]+/g) || []).forEach(ip => {
        if (isIPv4(ip)) {
          Network.map.set(ip, new Mochimo.Node({ ip }).toJSON());
        }
      });
    }
  },
  updateMap: (node, ip) => {
    const updateInterval = 30000; // 30 seconds between node updates
    const updateOffset = Date.now() - updateInterval;
    // if `ip` exists (ie. from Network.map.forEach), check update interval
    if (typeof ip === 'undefined') {
      // convert node to relevant JSON data
      node = node.toJSON();
      ip = node.ip;
      // update Network map, merging any existing data
      Network.map.set(ip, Object.assign(Network.map.get(ip) || {}, node));
      // check for peer updates
      if (node.peers && node.peers.length) {
        node.peers.forEach(ip => {
          // ignore private IPv4 or existing map nodes
          if (Utility.isPrivateIPv4(ip) || Network.map.has(ip)) return;
          // initialize new node
          Network.updateMap(new Mochimo.Node({ ip }));
        });
      }
      // initiate asynchronouse block check
      if (node.cblockhash) Block.check(ip, node.cblock, node.cblockhash);
      // broadcast node update to the 'network' room
      Server.broadcast('networkUpdates', { type: 'full', node });
    } else if (node.lastTouch < updateOffset) {
      // update lastTouch before next update check
      node.lastTouch = Date.now();
      // request peerlist and update map
      Mochimo.Node.callserver({ ip, opcode: Mochimo.OP_GETIPL })
        .then(Network.updateMap).catch(console.error);
    }
  },
  run: () => Network.map.forEach(Network.updateMap),
  start: async () => {
    console.log('Load network data');
    // prioritise network data acquisition:
    //   (database -> fallback(jsondata/peerlist)) ...
    try {
      const fname = Archive.file.nt('', 'last');
      if ((await Archive.search.nt(fname)).length) {
        const netJSON = await Archive.read.nt(fname);
        if (netJSON) {
          Network.parse(netJSON, 1);
          console.log(' + Successfully parsed network data from Archive');
        }
      }
    } catch (error) { console.error(` - ${error}`); }
    // utilise fallback methods on absence of database
    while (!Network.map.size) {
      // check for fallback failure
      if (!Network.fallback.length) {
        console.error(' - Network initialization failed! Retry in 30sec...');
        setTimeout(Network.start, 30000);
        return;
      }
      const fallback = Network.fallback.pop();
      try {
        // obtain and parse fallback data, type dependant
        Network.parse(fallback.startsWith('http')
          ? await Utility.request(https, fallback)
          : await fsp.readFile(fallback), fallback.endsWith('.json'));
        console.log(' + Success loading from', fallback);
      } catch (error) { console.error(` - ${error}`); }
    }
    // start run/backup loop
    console.log('Begin network scanning...');
    Timers.push(setInterval(Network.run, Network.interval));
  }
}; // end const Network...
const Server = {
  https: null,
  io: null,
  sockets: new Set(),
  broadcast: (room, event, data) => {
    // check Server.io is ready for broadcasts before calling
    if (Server.io) Server.io.to(room).emit(event, data);
  },
  connection: (socket) => {
    // socket management
    Server.sockets.add(socket);
    socket.on('close', () => Server.sockets.delete(socket));
    // block data may only be requested in parts (summary & tx's)
    /*
    socket.on('bsummary', async (req) => {
      const err = cleanRequest(req);
      if (err) return socket.emit('error', 'reqRejected: ' + err);
      const reqMessage = // reqBSummary#<blocknumber>.<blockhash>
        `reqBSummary#${(req.bnum || '')}.${(req.bhash || '').slice(0, 16)}`;
      try {
        const block = await Block.get(req.bnum, req.bhash);
        if (block) {
          socket.emit('bsummary', block.toSummary());
        } else socket.emit('error', `404: ${reqMessage}`);
      } catch (error) {
        const response = `ServerError during ${reqMessage}`;
        console.error(response, error);
        socket.emit('error', response);
      }
      // if request is NOT specific, return current Auxiliary data
      if (!bnum && !bhash && Block.latest) return Block.latest;
      // build file query and search
      const query = Archive.file.bc(bnum || '*', bhash || '*');
      const results = await Archive.search.bc(query);
      // handle results, if any
      if (results.length) {
        let block;
        do {
          try {
            // read (next) latest data as JSON
            block = new Mochimo.Block(await Archive.read.bc(results.shift()));
          } catch (ignore) {}
        } while (results.length && !block);
        return block || null;
      } else return null;
    });
    */
    socket.on('explorer', async () => {
      // register socket for block updates
      socket.join('blockUpdates');
      // self-assign request parameters (latest network consensus)
      const req = Object.assign({}, Network.getConsensus());
      try {
        socket.emit('wait', 'processing request...');
        const blocks = [];
        const transactions = [];
        // read latest blocks (x10) and latest transactions (x10)
        for (let i = 0; i < 10; i++) {
          const fname = Archive.file.bs(req.bnum, req.bhash);
          const block = await Archive.read.bs(fname);
          if (!block) break; // cannot continue
          blocks.unshift(block);
          // fill transactions
          if (transactions.length < 10) {
            const query = Archive.file.tx('*', req.bnum, req.bhash);
            const txs = await Archive.search.tx(query);
            while (txs.length && transactions.length < 10) {
              const txe = await Archive.read.tx(txs.pop());
              transactions.push(txe);
            }
          }
          // continue search of previous block
          req.bhash = block.phash;
          req.bnum -= 1n;
        }
        // emit latest data
        if (!blocks.length && !transactions.length) {
          socket.emit('error', '503: data unavailable');
        } else {
          blocks.forEach(block => socket.emit('latestBlock', block));
          transactions.forEach(txe => socket.emit('latestTransaction', txe));
        }
      } catch (error) {
        const response = '500: Internal Server Error';
        console.error(response, error);
        socket.emit('error', response);
      }
    });
    socket.on('haiku', async (req = {}) => {
      const err = Utility.cleanRequest(req);
      if (err) return socket.emit('error', 'reqRejected: ' + err);
      const reqMessage = // reqHaiku#<blocknumber>.<blockhash>
        `reqHaiku#${req.bnum || ''}.${(req.bhash || '').slice(0, 16)}`;
      // handle empty request parameters
      if (!req.bnum && !req.bhash) {
        // register socket for haiku updates
        socket.join('haikuUpdates');
        // self-assign request parameters (latest network consensus)
        Object.assign(req, Network.getConsensus());
      }
      try { // fill request
        let fname = Archive.file.hk(req.bnum || '*', req.bhash || '*');
        if (!req.bnum || !req.bhash) {
          // search for first possible result
          const search = await Archive.search.hk(fname);
          if (search.length) fname = search[0];
          else return socket.emit('error', `404: ${reqMessage}`);
        }
        const haiku = await Archive.read.hk(fname);
        if (haiku) socket.emit('haiku', haiku);
        else socket.emit('error', `404: ${reqMessage}`);
      } catch (error) {
        const response = `ServerError during ${reqMessage}`;
        console.error(response, error);
        socket.emit('error', response);
      }
    });
  },
  middleware: (socket, next) => {
    if (socket.handshake.auth && socket.handshake.auth.token) {
      // build authorization request
      const postData = querystring.encode({
        secret: process.env.CAPTCHA_SECRET,
        response: socket.handshake.auth.token
      });
      // check authorization token against Google's reCaptcha
      Utility.request(https, {
        hostname: 'recaptcha.net',
        path: '/recaptcha/api/siteverify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, postData).then(json => {
        // simple verification for now...
        if (!json) next(new Error('Server authentication failure'));
        else if (!json.success) next(new Error('Authentication failure'));
        else next(); // successful authentication
      }).catch(error => {
        console.error('[reCAPTCHA Request]', error);
        next(new Error('Server authentication error'));
      });
    } else next(new Error('Missing authentication token'));
  },
  start: () => new Promise((resolve, reject) => {
    // create http/s server
    Server.https = process.env.DEVELOPMENT
      ? http.createServer() // insecure development server
      : https.createServer({ // secure production server
        key: fs.readFileSync('/etc/ssl/private/io.mochimap.com.key'),
        cert: fs.readFileSync('/etc/ssl/certs/io.mochimap.com.pem')
      });
    // set https server events
    Server.https.on('error', reject);
    Server.https.on('listening', () => {
      const addr = Server.https.address();
      console.log(` + listening on ${addr.address} : ${addr.port}`);
      // server is ready for data transmission
      Server.io = SocketIO;
      resolve();
    });
    // create socket connection options
    const socketioOpts = {
      serveClient: false,
      // engine.IO options below
      pingInterval: 10000,
      pingTimeout: 5000,
      cookie: false,
      cors: {
        origin: 'https://www.mochimap.com',
        credentials: true
      }
    };
    if (process.env.DEVELOPMENT) {
      socketioOpts.cors.origin = true;
      console.log('Start Development IO Server');
    } else console.log('Start Production IO Server');
    // setup middleware authentication and connection protocols and attach to server
    SocketIO.use(Server.middleware);
    SocketIO.on('connection', Server.connection);
    SocketIO.attach(Server.https, socketioOpts);
    // start https server
    Server.https.listen(process.env.DEVELOPMENT ? 80 : 443, '0.0.0.0');
  })
};

/* cleanup */
const gracefulShutdown = (err, origin = 'unknown') => {
  console.error(`\nSHUTDOWN recv'd ${err} frpm ${origin}`);
  // clear timers
  while (Timers.length) clearInterval(Timers.pop());
  // close server and/or exit
  if (Server.http) {
    // initiate server shutdown
    Server.https.close(() => {
      console.log('Server closed... shutdown completed succesfully!\n');
      process.exit(Number(err) || 1);
    });
    // destroy remaining sockets
    Server.sockets.forEach(socket => socket.destroy());
  } else {
    console.log('Nothing to finish... shutdown completed succesfully!\n');
    process.exit(Number(err) || 1);
  }
};
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', gracefulShutdown);

/* startup */
console.log('Begin startup...');
// initialize archive, start io server and network scanning
Archive.init().then(Server.start).then(Network.start).catch(gracefulShutdown);