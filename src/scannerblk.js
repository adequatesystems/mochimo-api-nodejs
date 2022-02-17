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
const mochimo = require('mochimo');
const path = require('path');
const fs = require('fs');

function iferror (msg, err) {
  if (err) console.error(this.name, msg, err);
}

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
      const created = new Date(stime * 1000);
      const started = new Date(time0 * 1000);
      const blockJSON = { created, started, ...block.toJSON(true) };
      delete blockJSON.stime; delete blockJSON.time0;
      // normalize amount
      blockJSON.amount = MinBigInt(0xffffffffffffffffn, blockJSON.amount);
      // perform (and wait for successful) INSERT
      await this.db.promise().query('INSERT INTO `block` SET ?', blockJSON);
      // emit to stream
      if (this.emit) this.emit(blockJSON, 'block');
      // ======================
      // Transaction processing
      if (blockJSON.type === mochimo.Block.NORMAL) {
        // declare additional parameters for trasaction submissions
        const confirmed = created;
        const transactionAddDb = { created, confirmed, bnum, bhash };
        // INSERT transactions as IODKU operations for confirmed
        for (const txentry of block.transactions) {
          this.db.query(
            'INSERT INTO `transaction` SET ? ON DUPLICATE KEY UPDATE' +
            '`confirmed` = VALUES(`confirmed`), ' +
            '`bnum` = VALUES(`bnum`), `bhash` = VALUES(`bhash`)',
            { ...transactionAddDb, ...txentry.toJSON(true) },
            iferror.bind(this, '// transaction INSERT'));
        }
      }
      // =================
      // Ledger processing
      if (blockJSON.type === mochimo.Block.GENESIS ||
          blockJSON.type === mochimo.Block.NEOGENESIS) {
        let pngbhash = null;
        const pngaddr = {};
        if (bnum > 255n) {
          const pngbnum = bnum - 256n;
          // trace chain back to previous neogenesis block hash
          const blockResults = await this.db.promise().query(
            'SELECT * FROM `block` WHERE `bnum` < ? AND `bnum` >= ?' +
            ' ORDER BY `bnum` DESC', [bnum, pngbnum]);
          let phash = blockJSON.phash;
          for (let i = 0; i < blockResults.length; i++) {
            if (blockResults[i].bhash !== phash) continue;
            phash = blockResults[i].phash;
            if (blockResults[i].bnum === pngbnum) {
              pngbhash = blockResults.bhash;
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
              // create list of previous address balances
              for (const lentry of pngblock.ledger) {
                let { address } = lentry;
                const { balance, tag } = lentry;
                const delta = -(balance);
                const id = createHash('sha256').update(address).digest('hex');
                address = address.slice(0, 64);
                pngaddr[id] = { address, addressHash: id, tag, balance, delta };
              }
            } catch (pngError) {
              // report error and continue
              console.warn(this.name, '// Previous Neogenesis', pngError);
            }
          }
        }
        // clear balance entries for block before continuing
        await this.db.promise().query(
          'DELETE FROM `balance` WHERE `bnum` = ? AND `bhash` = ?',
          [bnum, bhash], iferror.bind(this, '// balance DELETE EXISTING'));
        // build array of ledger entries, then rank (sort) by descending balance
        const ledger = block.ledger.map((lentry) => {
          let { address } = lentry;
          const { balance, tag } = lentry;
          const addressHash = createHash('sha256').update(address).digest('hex');
          address = address.slice(0, 64);
          return { address, addressHash, tag, balance };
        }).sort((a, b) => {
          return (a.balance < b.balance) ? 1 : (a.balance > b.balance) ? -1 : 0;
        });
        // declare additional parameters for balance delta submissions
        const balananceAddDb = { created, bnum, bhash };
        let rank; // for every rank (or ledger entry)...
        for (rank = 0; rank < ledger.length; rank++) {
          // ... apply rank to entry and submit to richlist database
          const lentry = ledger[rank];
          const id = lentry.addressHash;
          this.db.query('REPLACE INTO `richlist` SET ?',
            { rank: rank + 1, ...lentry },
            iferror.bind(this, '// richlist REPLACE'));
          // ... determine balance delta and submit to balance database
          const pbalance = pngaddr[id] ? pngaddr[id].balance : 0n;
          if (pbalance !== lentry.balance) {
            // determine delta and push change (and normalize)
            const delta = NormalizeBigInt(lentry.balance - pbalance, true);
            // INSERT balance changes
            // ... if pnghash was determined, update on duplicate key
            this.db.query(
              pngbhash
                ? 'INSERT INTO `balance` SET ? ON DUPLICATE KEY UPDATE ' +
                '`balance` = VALUES(`balance`), `delta` = VALUES(`delta`)'
                : 'INSERT INTO `balance` SET ?',
              { ...balananceAddDb, ...lentry, delta },
              iferror.bind(this, '// balance INSERT'));
          }
          // remove entry from pngaddr cache
          delete pngaddr[id];
        }
        // DELETE remaining richlist ranks (if any)
        this.db.query('DELETE FROM `richlist` WHERE `rank` > ?', rank,
          iferror.bind(this, '// richlist DELETE'));
        // INSERT remaining pngaddr as emptied
        // ... if pnghash was determined, update on duplicate key
        for (const id in pngaddr) {
          // normalize deltas before insert
          pngaddr[id].delta = NormalizeBigInt(pngaddr[id].delta, true);
          this.db.query(
            pngbhash
              ? 'INSERT INTO `balance` SET ? ON DUPLICATE KEY UPDATE ' +
              '`balance` = VALUES(`balance`), `delta` = VALUES(`delta`)'
              : 'INSERT INTO `balance` SET ?',
            { ...balananceAddDb, ...pngaddr[id], balance: 0n },
            iferror.bind(this, '// remaining balance INSERT'));
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
