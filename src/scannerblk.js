/**
 * scannerblk.js; Mochimo Blockchain scanner
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

/* global BigInt */
const MaxBigInt = (...args) => args.reduce((m, v) => m >= v ? m : v);
const MinBigInt = (...args) => args.reduce((m, v) => m <= v ? m : v);
const NormalizeBigInt = (bigint, signed) => {
  bigint = BigInt(bigint);
  if (signed) {
    bigint = MinBigInt(bigint, 0x7fffffffffffffffn);
    bigint = MaxBigInt(bigint, -0x8000000000000000n);
  } else {
    bigint = MinBigInt(bigint, 0xffffffffffffffffn);
    bigint = MaxBigInt(bigint, 0x0n);
  }
  return String(bigint);
};

/* modules and utilities */
const Watcher = require('./watcher');
const { createHash } = require('crypto');
const { Readable, PassThrough } = require('stream');
const mochimo = require('mochimo');
const path = require('path');
const fs = require('fs');

const farchive = (bnum, bhash) => {
  return `b${asUint64String(bnum)}x${bhash.slice(0, 8)}.bc`;
};

const asUint64String = (bigint) => {
  return BigInt.asUintN(64, BigInt(bigint)).toString(16).padStart(16, '0');
};

/* Block Scanner */
module.exports =
class BlockScanner extends Watcher {
  constructor ({ archivedir, backupdir, db, emit, name, scanOnly, target }) {
    // apply default parameters
    archivedir = archivedir || path.join(process.cwd(), 'archive');
    backupdir = backupdir || path.join(process.cwd(), 'backup');
    name = name || 'BlockchainScanner';
    target = target || path.join(
      path.sep, 'home', 'mochimo-node', 'mochimo', 'bin', 'd', 'bc'
    );
    // Watcher()
    super({ name: 'BLKSCANNER', target, scanOnly });
    // apply instance parameters
    Object.assign(this, {
      archivedir, backupdir, db, emit, name, scanOnly, target
    });
    this.dbfail = false;
    this.processing = false;
    this.queue = [];
  }

  cleanup () {
    super.cleanup();
    if (this._watchrecovery) {
      console.log(this.name, '// recovery terminating...');
      this._watchrecovery.close();
      this._watchrecovery = undefined;
    }
  }

  async handler (stats, eventType, filename) {
    // accept only 'rename' events where filename extension is '.bc'
    if (filename && filename.endsWith('.bc') && eventType === 'rename') {
      // add file to queue (blocks can be large, do one at a time)
      this.queue.push(path.join(this.target, filename));
      // start queue processor if not already
      if (!this.processing) {
        this.processing = true;
        setImmediate(this.procBlocks.bind(this));
      }
    } // end if (filename...
  } // end handler...

  async procBlocks () {
    // obtain next block filepath
    const filepath = this.queue.shift();
    let filename = path.basename(filepath);
    let data;
    try {
      // check access and read file
      await fs.promises.access(filepath, fs.constants.R_OK);
      data = await fs.promises.readFile(filepath);
      // interpret data as mochimo Block
      const block = new mochimo.Block(data);
      // invalid block checks
      if (data.length % mochimo.LEntry.length !== 164 && // pseudo || neogen
          data.length % mochimo.TXEntry.length !== 2380) { // normal
        throw new Error(`${filepath} invalid block size: ${data.length}`);
      } else if (!block.verifyBlockHash()) {
        throw new Error(`${filepath} invalid block hash`);
      }
      // extract bnum and bhash
      const { bnum, bhash, stime, time0 } = block;
      // edit filename for archives
      filename = farchive(bnum, bhash);
      // build JSON block data for INSERT
      const created = new Date(stime * 1000).toISOString()
        .replace(/(.*)T(.*)\..*/, '$1 $2');
      const started = new Date(time0 * 1000).toISOString()
        .replace(/(.*)T(.*)\..*/, '$1 $2');
      const blockJSON = { created, started, ...block.toJSON(true) };
      delete blockJSON.stime; delete blockJSON.time0;
      // normalize amount
      if (blockJSON.amount) {
        blockJSON.amount = NormalizeBigInt(blockJSON.amount);
      }
      // perform (and wait for successful) INSERT
      await this.db.promise().query('INSERT INTO `block` SET ?', blockJSON);
      // emit to stream
      if (this.emit) this.emit(blockJSON, 'block');
      // ======================
      // Transaction processing
      if (blockJSON.type === mochimo.Block.NORMAL) {
        // declare additional parameters for trasactions
        const txinfo = { created, confirmed: created, bnum, bhash };
        const transactions = block.transactions.map((txentry) => {
          return { ...txinfo, ...txentry.toJSON(true) };
        });
        // define temporary table name
        const table = '`~txs' + bhash.slice(0, 8) + '`';
        // create connection specifically for inserting transactions
        const connection = await this.db.promise().getConnection();
        // ensure connection is always released back to pool
        try {
          // create temporary table for bulk data
          await connection.query('CREATE TEMPORARY TABLE ' + table +
            ' SELECT * FROM `mochimo`.`transaction` LIMIT 0');
          // stream transactions as CSV to temp table
          const fields = Object.keys(transactions[0]);
          const sql =
            'LOAD DATA LOCAL INFILE "stream" INTO TABLE ' + table +
            ' FIELDS TERMINATED BY "," LINES TERMINATED BY ";"' +
            ' (' + fields.join(', ') + ')';
          const infileStreamFactory = () => Readable.from((async function * () {
            for (let i = 0; i < transactions.length; i++) {
              yield (i !== 0 ? ';' : '') + fields.reduce((a, c) => {
                return a + (a ? ',' : '') + transactions[i][c];
              }, '');
            }
          })()).pipe(new PassThrough());
          await connection.query({ sql, infileStreamFactory });
          // insert into transaction table with temp table (IODKU)
          await connection.query(
            'INSERT INTO `transaction` SELECT * from ' + table +
            ' ON DUPLICATE KEY UPDATE `confirmed` = VALUES(`confirmed`),' +
            ' `bnum` = VALUES(`bnum`), `bhash` = VALUES(`bhash`)');
        } catch (error) {
          console.error(this.name, '// TRANSACTION', error);
        } finally {
          // return connection to pool
          if (connection) connection.release();
        }
      }
      // =================
      // Ledger processing
      if (blockJSON.type === mochimo.Block.GENESIS ||
          blockJSON.type === mochimo.Block.NEOGENESIS) {
        let pngbhash = null;
        const ngdata = {};
        if (bnum > 255n) {
          const pngbnum = bnum - 256n;
          // trace chain back to previous neogenesis block hash
          const [blockResults] = await this.db.promise().query(
            'SELECT * FROM `block` WHERE `bnum` < ? AND `bnum` >= ?' +
            ' ORDER BY `bnum` DESC', [bnum, pngbnum]);
          let phash = blockJSON.phash;
          for (let i = 0; i < blockResults.length; i++) {
            if (blockResults[i].bhash !== phash) continue;
            phash = blockResults[i].phash;
            if (blockResults[i].bnum === pngbnum.toString()) {
              pngbhash = blockResults[i].bhash;
              break;
            }
          }
          // proceed only if hash was determined
          if (pngbhash) {
            // pull file data from archive
            const pngfilename = farchive(pngbnum, pngbhash);
            const pngfilepath = path.join(this.archivedir, pngfilename);
            try {
              // read previous neogen data
              const pngdata = await fs.promises.readFile(pngfilepath);
              // perform pre-checks on pngdata
              if (pngdata.length % mochimo.LEntry.length !== 164) {
                throw new Error(`${filepath} invalid size: ${pngdata.length}`);
              }
              // interpret blockdata as mochimo Block
              const pngblock = new mochimo.Block(pngdata);
              // perform block hash verification check
              if (!pngblock.verifyBlockHash()) {
                throw new Error(`${filepath} block hash could not be verified`);
              }
              // declare additional parameters for neogen data
              const leinfo = { created, bnum, bhash };
              const fields = [
                'created', 'bnum', 'bhash', 'address',
                'addressHash', 'tag', 'balance', 'delta'
              ];
              // load previous neogen data
              for (const lentry of pngblock.ledger) {
                let { address, balance } = lentry;
                const { tag } = lentry;
                const id = createHash('sha256').update(address).digest('hex');
                const delta = NormalizeBigInt(-(balance), true);
                address = address.slice(0, 64);
                balance = 0n; // assume empty
                ngdata[id] = {
                  ...leinfo, address, addressHash: id, tag, balance, delta
                };
              }
              // load latest neogen data
              for (const lentry of block.ledger) {
                let { address } = lentry;
                const { balance, tag } = lentry;
                const id = createHash('sha256').update(address).digest('hex');
                const pdelta = id in ngdata ? ngdata[id].delta : 0n;
                const delta = NormalizeBigInt(balance + BigInt(pdelta), true);
                address = address.slice(0, 64);
                ngdata[id] = {
                  ...leinfo, address, addressHash: id, tag, balance, delta
                };
              }
              // define temporary table name
              const table = '`~neo' + bhash.slice(0, 8) + '`';
              // create connection specifically for inserting transactions
              const connection = await this.db.promise().getConnection();
              // ensure connection is always released back to pool
              try {
                // create temporary table for bulk data
                await connection.query('CREATE TEMPORARY TABLE ' + table +
                  ' SELECT * FROM `mochimo`.`neogen` LIMIT 0');
                // stream neogen data as CSV to temp table
                const sql =
                  'LOAD DATA LOCAL INFILE "stream" INTO TABLE ' + table +
                  ' FIELDS TERMINATED BY "," LINES TERMINATED BY ";"' +
                  ' (' + fields.join(', ') + ')';
                const infileStreamFactory = () => {
                  return Readable.from((async function * () {
                    let count = 0;
                    for (const id in ngdata) {
                      yield (count++ ? ';' : '') + fields.reduce((a, c) => {
                        return a + (a ? ',' : '') + ngdata[id][c];
                      }, '');
                    }
                  })()).pipe(new PassThrough());
                };
                await connection.query({ sql, infileStreamFactory });
                // (pre)DELETE un-needed ranks from richlist
                await connection.query(
                  'DELETE FROM `richlist` WHERE `rank` >' +
                  ' (SELECT count(*) FROM ' + table + ' WHERE `balance` > 0)');
                // REPLACE into richlist table from temp (add RANK())
                await connection.query(
                  'REPLACE INTO `richlist` SELECT `address`, `addressHash`,' +
                  ' `tag`, `balance`, RANK() OVER(ORDER BY `balance` DESC)' +
                  ' as `rank` from ' + table + ' WHERE `balance` > 0');
                // insert into balance table from temp table (IODKU)
                await connection.query(
                  'INSERT INTO `neogen` SELECT `created`, `bnum`, `bhash`,' +
                  ' `address`, `addressHash`, `tag`, `balance`, `delta`' +
                  ' from ' + table + ' WHERE delta != 0');
              } catch (error) {
                console.error(this.name, '// NEOGENESIS', error);
              } finally {
                // return connection to pool
                if (connection) connection.release();
              }
            } catch (pngError) {
              // report error and continue
              console.warn(this.name, '// Previous Neogenesis', pngError);
            }
          }
        }
      }
      // check recovery flag
      if (this.dbfail) {
        this.dbfail = false;
        this.recoverBackups();
      }
    } catch (error) {
      // check database errors
      if ('sql' in error) {
        // for non duplicate entry errors...
        if (error.code !== 'ER_DUP_ENTRY') {
          // ... attempt to backup block for later recovery
          if (data) {
            this.writeBlock(data, filename, this.backupdir).catch((error) => {
              console.error(this.name, '// BACKUP', error);
            });
          }
          // ... report and flag error (if not already)
          console.error(this.name, '// DB', error);
          if (this.dbflag === false) {
            console.log(this.name, '// DB FAILURE MODE ACTIVATED');
            this.dbfail = true;
          }
        }
      } else
      // ignore file errors that don't or no longer exist
      if (error.code !== 'ENOENT') {
        console.error(this.name, '//', error);
      }
    } finally {
      // attempt to archive block for storage
      if (data) {
        this.writeBlock(data, filename, this.archivedir).catch((error) => {
          console.error(this.name, '// ARCHIVE', error);
        });
      }
      // continue processing of blocks (if any remaining)
      if (this.queue.length) {
        setImmediate(this.procBlocks.bind(this));
      } else this.processing = false;
    }
  }

  recoverBackups () {
    console.log(this.name, '// DB RECOVERY MODE ACTIVATED');
    // reset db failure mode
    this.dbfail = false;
    // create new Watcher in scanOnly mode
    this._watchrecovery = new Watcher({
      name: 'BLKRECOVERYSCAN', scanOnly: true, target: this.backupdir
    });
  }

  async writeBlock (data, fname, dir) {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, fname), data);
  }
};
