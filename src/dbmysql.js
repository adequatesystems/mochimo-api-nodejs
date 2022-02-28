/**
 * dbmysql.js; MySQL interface
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

const interpreter = /^([0-9a-z]+)(?:(<>|<=|>=|<|>|=)([0-9a-z-.*]+))?$/i;
const separators = /[?&|]/g;

const mysql2 = require('mysql2');

const stdOpts = {
  waitForConnections: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z'
};

function requestHandler (table, options, callback) {
  let { limit, offset, orderby, search, select } = options;
  let groupCondition = null;
  let nConditions = 0;
  let where = '';
  // consume search and place in `where`
  while (search) {
    const nextbrkp = search.slice(1).search(separators) + 1;
    const condition = nextbrkp
      ? search.slice(1, nextbrkp)
      : search.slice(1);
    // check condition
    if (condition) {
      const matched = condition.match(interpreter);
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
                // encase existing conditions on groupCondition change
                if (groupCondition && groupCondition !== search.charAt(0)) {
                  where = `( ${where} )`;
                }
                groupCondition = search.charAt(0);
                // apply condition extension
                if (groupCondition === '&') where += ' AND ';
                if (groupCondition === '|') where += ' OR ';
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
  this.query(`
    SELECT ${
      Array.isArray(select) ? select.join(', ') : (select || '*')}
    from \`${table}\`
    ${where ? `WHERE ${where}` : ''}
    ${orderby ? `ORDER BY ${orderby}` : ''}
    ${limit ? `LIMIT ${limit}` : 'LIMIT 10'}
    ${offset ? `OFFSET ${offset}` : ''}
  `, callback);
}

const constructHandler = {
  construct (target, args) {
    const options = { ...stdOpts, ...args.shift() };
    const db = mysql2.createPool(options);
    db.request = requestHandler;
    return db;
  }
};

module.exports = new Proxy(mysql2.createPool, constructHandler);
