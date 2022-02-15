/**
 * apiUtils.js; Mochimo Cryptocurrency Network API utilities
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/* global BigInt */
const https = require('https');

module.exports = {
  asUint64String: (bigint) => {
    return BigInt.asUintN(64, BigInt(bigint)).toString(16).padStart(16, '0');
  },
  blockReward: function (bnum) {
    bnum = BigInt(bnum);
    // 'delta' reward adjustments, 'base' rewards & 'trigger' blocks
    const delta = [56000n, 150000n, 28488n];
    const base = [5000000000n, 5917392000n, 59523942000n];
    const trigger = [17185n, 373761n, 2097152n];
    // Reward after final block reward distribution + block height check
    if (bnum > trigger[2] || bnum <= 0n) return 0n;
    // Reward before v2.0 block trigger 0x4000
    if (bnum < trigger[0]) return (base[0] + delta[0] * --bnum);
    // Reward first remaining ~4 years (post v2.0) of distribution
    if (bnum < trigger[1]) return (base[1] + delta[1] * (bnum - trigger[0]));
    // Reward for last ~18 years of distribution
    return (base[2] - delta[2] * (bnum - trigger[1]));
  },
  capitalize: (s) => s.length ? s[0].toUpperCase() + s.slice(1) : '',
  compareWeight: function (weight1, weight2) {
    // ensure both strings are equal length
    const maxLen = Math.max(weight1.length, weight2.length);
    weight1 = weight1.padStart(maxLen, '0');
    weight2 = weight2.padStart(maxLen, '0');
    // return 1 (a > b), -1 (a < b) or 0 (a == b)
    if (weight1 > weight2) return 1;
    if (weight1 < weight2) return -1;
    return 0;
  },
  objectIsEmpty: function (obj) {
    for (const prop in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, prop)) return false;
    }
    return true;
  },
  projectedSupply: function (bnum, exclLocked) {
    // ... as per https://www.mochiwiki.com/w/index.php/Premine_Disposition
    const Locked = 1990000000000000n;
    const LockedEpoch = 1687651200000; // 25th June 2023 GM
    const Instamine = 4757066000000000n; // inclusive of any locked dev coins
    const BigIntMin = (...args) => args.reduce((m, e) => e < m ? e : m);
    const Sn = (n, b1, bn) => {
      return n * (this.blockReward(b1) + this.blockReward(bn)) / 2n;
    }; // Sum of an Arithmetic Sequence; Sn = n(A1+An)/2
    // without input, project maximum supply at block 0x200000
    bnum = bnum ? BigInt(bnum) : 2097152n;
    // Due to hard fork @ 0x4321, formula is split into 3 separate calculations
    let allblocks = 0n;
    let neogen = 0n;
    let locked = 0n;
    let nn = 0n;
    // 0x1 to 0x4320...
    nn = BigIntMin(0x4320n, bnum); // max 0x4320
    allblocks += Sn(nn, 1n, nn);
    nn = BigIntMin(0x4300n, bnum) >> 8n << 8n; // max 0x4300
    neogen += Sn(nn >> 8n, 256n, nn);
    // 0x4321 to 0x5B400...
    nn = BigIntMin(0x5B400n, bnum); // max 0x5B400
    allblocks += Sn(bnum > 0x4320n ? nn - 0x4320n : 0n, 0x4321n, nn);
    nn = BigIntMin(0x5B400n, bnum) >> 8n << 8n; // max 0x5B400
    neogen += Sn(bnum > 0x4300n ? (nn - 0x4300n) >> 8n : 0n, 0x4400n, nn);
    // 0x5B401 to 0x200000
    nn = BigIntMin(0x200000n, bnum); // max 0x200000
    allblocks += Sn(bnum > 0x5B400n ? nn - 0x5B400n : 0n, 0x5B401n, nn);
    nn = BigIntMin(0x200000n, bnum) >> 8n << 8n; // max 0x200000
    neogen += Sn(bnum > 0x5B400n ? (nn - 0x5B400n) >> 8n : 0n, 0x5B500n, nn);
    // instamine plus all block rewards minus neogen rewards (minus Locked)*
    // *where exclLocked is set AND epoch is before LockedEpoch
    if (exclLocked && Date.now() < LockedEpoch) locked = Locked;
    return Instamine + allblocks - neogen - locked;
  },
  readWeb: function (options, postData) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let body = [];
        res.on('data', chunk => body.push(chunk)); // accumulate data chunks
        res.on('end', () => { // concatenate data chunks
          body = Buffer.concat(body).toString();
          try { // pass JSON Object
            resolve(JSON.parse(body));
          } catch (ignore) { resolve(body); }
        });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  },
  round: function (value, places = 2) {
    const multiplier = Math.pow(10, places);
    return Math.round(value * multiplier) / multiplier;
  },
  rwdShuffle: function (array, maxItems = 16) {
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
  },
  searchAppend: (search, str) => (search ? search + '&' : '?') + str
};
