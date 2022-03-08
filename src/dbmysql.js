/**
 * dbmysql.js; MySQL interface
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

const mysql2 = require('mysql2');

const paramRegex = /^([0-9a-z]+)(?:(<>|<|<=|=|>=|>)([0-9a-z-.*]+))?$/i;
const paramSeparatorRegex = /[?&|]/g;

const stdOpts = {
  waitForConnections: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z'
};

function queryComponents ({ limit = 10, offset = 0, search, where = '' }) {
  // consume search and place in `where`
  while (search) {
    const nextbrkp = search.slice(1).search(paramSeparatorRegex) + 1;
    const condition = nextbrkp
      ? search.slice(1, nextbrkp)
      : search.slice(1);
    // check condition
    if (condition) {
      const matched = condition.match(paramRegex);
      if (matched) {
        // drop initial match
        matched.shift();
        let [column, comparitor, value] = matched;
        // check for "special" parameters
        if (value) {
          switch (column) {
            case 'limit':
              // cleanse limit value
              limit = isNaN(value) ? 10 : Number(value);
              if (limit > 100) limit = 100;
              if (limit < 1) limit = 1;
              break;
            case 'offset':
              // cleanse offset value
              offset = isNaN(value) ? 0 : Number(value);
              if (offset < 0) offset = 0;
              break;
            default:
              column = `\`${column}\``;
              value = value.toLowerCase();
              if (['<>', '='].includes(comparitor)) {
                if (value === 'null') {
                  // special treatment for null values
                  value = 'NULL';
                  if (comparitor === '<>') comparitor = 'IS NOT';
                  else if (comparitor === '=') comparitor = 'IS';
                } else if (value.includes('*')) {
                  // special treatment for wildcard values
                  value = `'${value.replace(/[*]/g, '%')}'`;
                  if (comparitor === '<>') comparitor = 'NOT LIKE';
                  else if (comparitor === '=') comparitor = 'LIKE';
                } else value = `'${value}'`;
              } else value = `'${value}'`;
              // apply condition extension
              if (where) where += ' AND ';
              // apply where condition
              where += `${column} ${comparitor} ${value}`;
          }
        }
      }
    }
    // reduce search for next round
    search = nextbrkp ? search.slice(nextbrkp) : '';
  }
  // return components as object
  return { limit, offset, where };
}

function requestHandler (table, options, callback) {
  // extract query components from search and options
  const { limit, offset, orderby, select = '*', union, where } = {
    ...options, ...queryComponents(options)
  };
  if (Array.isArray(union) && union.length) {
    const queries = union.map((subsearch) => {
      const sub = queryComponents({
        limit: limit + offset, search: subsearch, where
      });
      return `SELECT ${select} FROM \`${table}\`
        ${sub.where ? `WHERE ${sub.where}` : ''}
        ${orderby ? `ORDER BY ${orderby}` : ''}
        LIMIT ${sub.offset}, ${sub.limit}`;
    });
    // execute compound (union) query
    return this.query(`
      (${queries.join(') UNION DISTINCT (')})
      ${orderby ? `ORDER BY ${orderby}` : ''}
      LIMIT ${offset}, ${limit}
    `, callback);
  }
  // execute simple query
  return this.query(`
    SELECT ${select || '*'} FROM \`${table}\` ${where ? `WHERE ${where}` : ''}
    ${orderby ? `ORDER BY ${orderby}` : ''} LIMIT ${offset}, ${limit}
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
