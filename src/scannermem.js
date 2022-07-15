/**
 * scannermem.js; Mochimo Mempool (txclean.dat) scanner
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/* modules and utilities */
const { sha256 } = require('./apiUtils');
const Watcher = require('./watcher');
const mochimo = require('mochimo');
const fs = require('fs');

/* Mempool Scanner */
module.exports =
class MempoolScanner extends Watcher {
  constructor ({ db, emit, target, scanOnly }) {
    // apply default target
    if (typeof target !== 'string') {
      target = '/home/mochimo/main/bin/d/txclean.dat';
    }
    // Watcher()
    super({ name: 'MEMSCANNER', target, scanOnly });
    // apply instance parameters
    Object.assign(this, { db, emit, fp: 0, target });
  }

  handler (stats, eventType) {
    // 'rename' events trigger this.fp reset ONLY; events missing stats are ignored
    if (eventType === 'rename') this.fp = 0;
    if (eventType === 'rename' || !stats) return;
    // determine if TXCLEAN has valid bytes to read
    const { length } = mochimo.TXEntry;
    const { size } = stats;
    // check mempool for filesize reduction, reset this.fp
    if (size < this.fp) this.fp = 0;
    // ensure mempool has data
    let position = this.fp;
    const remainingBytes = size - position;
    if (remainingBytes) {
      // ensure remainingBytes is valid factor of TXEntry.length
      const invalidBytes = remainingBytes % length;
      if (invalidBytes) { // report error in position or (likely) filesize
        const details = { size, position, remainingBytes, invalidBytes };
        return console.trace(`TXCLEAN invalid, ${JSON.stringify(details)}`);
      } else this.fp = size; // adjust this.fp to size
      // obtain mempool filehandle
      let filehandle;
      fs.promises.open(this.target).then((handle) => {
        filehandle = handle; // store handle and read chunk of data into buffer
        return handle.read({ buffer: Buffer.alloc(remainingBytes), position });
      }).then((result) => {
        // ensure sufficient bytes were read
        if (result.bytesRead !== remainingBytes) {
          const details = JSON.stringify({ position, result });
          throw new Error(`Insufficient Mempool bytes read, ${details}`);
        } // interpret 'length' segments of bytes as TXEntry's
        for (position = 0; position < remainingBytes; position += length) {
          const txebuffer = result.buffer.slice(position, position + length);
          const txentry = new mochimo.TXEntry(txebuffer);
          const txjson = txentry.toJSON(true);
          txjson.txhash = sha256(txentry);
          if (this.db) {
            // check txhash does not already exist
            this.db.query('SELECT * FROM `transaction` where `txhash` = ?',
              txjson.txhash, (error, results) => {
                if (error) return console.error(error);
                if (results.length) return; // ignore dup
                // insert "unconfirmed" transaction to db
                this.db.query('INSERT INTO `transaction` SET ?', txjson,
                  (error) => {  // report NON-ER_DUP_ENTRY errors
                    if (error && error.code !== 'ER_DUP_ENTRY') {
                      console.error(error);
                    }
                  });
              });
          }
          // return transaction in callback
          if (typeof this.emit === 'function') {
            this.emit(txjson, 'transaction');
          }
        } // end for (position...
      }).catch(console.trace).finally(() => {
        // ensure filehandle gets closed
        if (filehandle) filehandle.close();
      }); // end fs.promises.open... catch... finally...
    } // end if (remainingBytes...
  } // end handler...
};
