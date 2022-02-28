/**
 * scannernet.js; Mochimo Network scanner
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/**
 * Determines if the provided variable is empty/null.
 **
 * Mainly for arrays and objects but can be used on simple variables.
 * Main Test cases:
 *    {}            -> true
 *    []            -> true
 *    [null]        -> true
 *    {a:null}      -> false
 *    {a:null, b:1} -> false
 *    {a:1, b:null} -> false
 *    [null, 1]     -> false
 *    [1, null]     -> false
 */// Returns, Boolean
function isEmpty (variable) {
  // Handle Objects and Arrays
  if (typeof variable === 'object') {
    for (const key in variable) {
      // Arrays containing any non-NULL value are NOT considered empty
      if ((variable.constructor === Array && variable[key]) ||
      // Objects containing null values for valid keys are NOT considered empty
        (variable.constructor !== Array && variable)) {
        return false;
      }
    }
  } else
  // Handle all other
  if (variable) return false;

  return true;
}

/**
 * Simple Object duplication.
 **
 * Mainly used for breaking free of referenced objects.
 */// Returns, Object (duplicate)
function dupObj (obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* diffObj(), A RECURSIVE function to detect the differences
 * that exist between 2 different states of the same object.
 **
 * Depends on: isEmpty()
 * Used to reduce bandwidth by upwards of 95%.
 * (compared to the first revision of bandwidth transmission)
 **
 */// Returns difference, else false on no difference
function diffObj (curr, old) {
  const changes = {};
  for (const key in curr) {
    if (!(key in old)) changes[key] = curr[key];
  }
  for (const key in old) {
    if (!(key in curr)) { changes[key] = undefined; continue; }
    if (old[key] && typeof old[key] === 'object' &&
      ((typeof old[key] === typeof curr[key]))) {
      // Handle Arrays
      // * add -> typeof curr[key][0] !== 'object'
      // * to conditions if objects are expected in arrays
      if (old[key].constructor === Array &&
        ((old[key].constructor === curr[key].constructor))) {
        const tempA = [];
        // scan 'old' for absent items, mark to delete
        for (let i = 0; i < old[key].length; i++) {
          if (curr[key].indexOf(old[key][i]) < 0) {
            tempA[i] = undefined;
          }
        }
        // scan 'curr' for new items, fill deleted or append
        for (let i = 0; i < curr[key].length; i++) {
          if (old[key].indexOf(curr[key][i]) < 0) {
            const fill = tempA.indexOf(undefined);
            if (fill > -1) tempA[fill] = curr[key][i];
            else tempA[old[key].length + i] = curr[key][i];
          }
        }
        // copy changes to 'curr' else no changes
        if (tempA.length) changes[key] = tempA;
      } else {
        // Handle Objects
        const recursivechanges = diffObj(curr[key], old[key]);
        if (recursivechanges) changes[key] = recursivechanges;
      }
    } else if (old[key] !== curr[key]) changes[key] = curr[key];
  }
  return isEmpty(changes) ? false : changes;
}

/* constants */
const MS7DAY = 7 * 24 * 60 * 60 * 1000;
const MS3DAY = 3 * 24 * 60 * 60 * 1000;
const MS30SECOND = 30 * 1000;

/* modules and utilities */
const { IPinfoWrapper, LruCache } = require('node-ipinfo');
const Mochimo = require('mochimo');
const Lru = require('lru-cache');

/* environment initialization */
require('dotenv').config();
const MAXIPNUM = process.env.MAXIPNUM || 5000;
const MAXIPAGE = process.env.MAXIPAGE || MS7DAY;
const MAXNODEAGE = process.env.MAXNODEAGE || MS3DAY;
const MAXSCAN = process.env.MAXSCAN || 128;
const IPINFOTOKEN = process.env.IPINFOTOKEN;
const NODEIP = process.env.NODEIP || '127.0.0.1';

/* ipinfo initialization */
const ipinfoCache = new LruCache({ max: MAXIPNUM, maxAge: MAXIPAGE });
const ipinfo = new IPinfoWrapper(IPINFOTOKEN, ipinfoCache);

/* Network Scanner class */
module.exports =
class NetworkScanner {
  constructor ({ emit }) {
    /* environment check */
    if (IPINFOTOKEN === 'undefined') {
      console.warn(this.name, '//', 'missing IPINFOTOKEN');
      console.warn(this.name, '//', 'IP info will not be available');
    }
    // apply instance parameters
    const idle = undefined;
    Object.assign(this, {
      cache: new Lru({ max: MAXIPNUM, maxAge: MAXNODEAGE }),
      ...{ emit, idle, name: 'NETSCANNER', scanning: new Set() }
    });
    // begin network scan (asynchronous)
    this.init();
    this.run();
  }

  cleanup () {
    if (this._timeout) {
      console.log(this.name, '//', 'clearing timeout...');
      clearTimeout(this._timeout);
      this._timeout = undefined;
    }
  }

  getPeers (matchParams = {}, orderby = 'best') {
    const peers = this.cache.dump().reduce((acc, cur) => {
      for (const param in matchParams) {
        if (param in cur.v && cur.v[param] !== matchParams[param]) {
          return acc;
        }
      }
      acc.push(cur.v);
      return acc;
    }, []);
    switch (orderby) {
      case 'ip':
        // sort peers (in-place) by ip string
        peers.sort((a, b) => ('' + a.ip).localeCompare(b.ip));
        break;
      default:
        // sort peers (in-place) by weight, then uptime
        peers.sort((a, b) => {
          const aWeight = BigInt(`0x0${a.weight}`);
          const bWeight = BigInt(`0x0${b.weight}`);
          if (aWeight < bWeight) return 1;
          if (aWeight > bWeight) return -1;
          const aUptime = a.uptimestamp ? a.timestamp - a.uptimestamp : 0;
          const bUptime = b.uptimestamp ? b.timestamp - b.uptimestamp : 0;
          return bUptime - aUptime;
        });
    }
    return peers;
  }

  init () {
    if (this.cache.size) {
      console.log(this.name, '//', '(re)scan network cache...');
    } else console.log(this.name, '//', 'begin network scan...');
    // scan NODEIP and any cache
    this.scan(NODEIP);
    this.cache.keys().forEach(this.scan.bind(this));
  }

  run () {
    // queue next this.run() to execute approx. every second
    setTimeout(this.run.bind(this), 1000);
    // init run
    let netVEOK = 0;
    const now = Date.now();
    // (re)scan VEOK nodes and their respective peerlist
    this.cache.keys().forEach((ip) => {
      const node = this.cache.peek(ip);
      if (node && node.status === Mochimo.VEOK) {
        // assume network is OK
        netVEOK++;
        if (this.idle) {
          console.warn(this.name, '//', 'communication restored!');
          this.idle = undefined;
        }
        // check rescan
        this.scan(ip);
        if (Array.isArray(node.peers)) {
          node.peers.forEach(this.scan.bind(this));
        }
      }
    });
    // check network status
    if (!netVEOK) {
      // check idle timer
      if (!this.idle) {
        console.warn(this.name, '//', 'communication loss detected!');
        // record timestamp of communication loss
        this.idle = Date.now();
      } else {
        // assume ongoing network communications loss
        const idleTime = now - this.idle;
        if (idleTime > MS30SECOND) {
          this.idle = Date.now(); // reset idle time
          console.error(this.name, '//', 'extended communication loss!');
          console.error(this.name, '//', 'perform re-initialization...');
          this.init();
        }
      }
    }
  }

  scan (ip) {
    // avoid non-localhost private ips
    if (NetworkScanner.isPrivateIPv4(ip)) return;
    // avoid duplicate scans
    if (this.scanning.has(ip)) return;
    // add 1 second delay scans exceeding maximum
    if (this.scanning.size >= MAXSCAN) {
      return setTimeout(this.scan.bind(this, ip), 1000);
    }
    // register asynchronous scan
    this.scanning.add(ip);
    this.scanNode(ip).catch((error) => {
      console.trace(this.name, '// SCAN', error);
    }).finally(() => this.scanning.delete(ip));
  }

  async scanNode (ip) {
    // obtain time and cached node state (if any)
    const now = Date.now();
    const cached = this.cache.get(ip) || { timestamp: 0, uptimestamp: 0 };
    // check for outdated node state
    if (!cached.timestamp || cached.timestamp < (now - MS30SECOND)) {
      // build node options and perform peerlist request for latest state
      const nodeOptions = { ip, opcode: Mochimo.OP_GETIPL };
      let node = (await Mochimo.Node.callserver(nodeOptions)).toJSON();
      // if node is VEOK refresh uptimestamp...
      if (node.status === Mochimo.VEOK) {
        if (!cached.uptimestamp) node.uptimestamp = node.timestamp;
        if (IPINFOTOKEN) {
          try { // ... and obtain IP info data
            const info = await ipinfo.lookupIp(ip);
            if (info.error) throw info.error;
            node = { ...info, ...node };
          } catch (error) {
            console.trace(this.name, '// IPINFO', error);
          }
        }
      } else node.uptimestamp = 0;
      // calculate differences between cached node
      const changes = diffObj(node, cached);
      // ensure ip is always delivered with changes
      if (changes) changes.ip = node.ip;
      // update cached node object
      Object.assign(cached, node);
      // if VEOK and not in cache...
      if (cached.status === Mochimo.VEOK && !this.cache.has(ip)) {
        // ... update cache, and extend scan to peers of valid node
        this.cache.set(ip, cached);
        if (Array.isArray(cached.peers)) {
          cached.peers.forEach(this.scan.bind(this));
        }
      }
      // emit changes to stream where ip is in cache
      if (changes && this.cache.has(ip) && typeof this.emit === 'function') {
        this.emit(changes, 'network');
      }
    }
  }

  static isPrivateIPv4 (ip) {
    const b = new ArrayBuffer(4);
    const c = new Uint8Array(b);
    const dv = new DataView(b);
    if (typeof ip === 'number') dv.setUint32(0, ip, true);
    if (typeof ip === 'string') {
      const a = ip.split('.');
      for (let i = 0; i < 4; i++) dv.setUint8(i, a[i]);
    }
    if (c[0] === 0 || c[0] === 127 || c[0] === 10) return 1; // class A
    if (c[0] === 172 && c[1] >= 16 && c[1] <= 31) return 2; // class
    if (c[0] === 192 && c[1] === 168) return 3; // class C
    if (c[0] === 169 && c[1] === 254) return 4; // auto
    return 0; // public IP
  }
};
