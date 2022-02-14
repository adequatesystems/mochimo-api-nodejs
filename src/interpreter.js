/**
 * interpreter.js; Interprets input data of API requests (LEGACY)
 * Copyright (c) 2022  Adequate Systems LLC.  All rights reserved
 * For more information, see License.md
 */

const Parse = {
  mod: {
    begins: (val) => ({ $regex: new RegExp(`^${val}`) }),
    contains: (val) => ({ $regex: new RegExp(`${val}`) }),
    ends: (val) => ({ $regex: new RegExp(`${val}$`) }),
    exists: (val) => ({ $exists: val === 'false' ? false : Boolean(val) })
  },
  special: {
    network: {
      'connection.status': (val) => ({
        $or: [
          { 'connection.de.status': val },
          { 'connection.sg.status': val },
          { 'connection.us.status': val }
        ]
      })
    },
    transaction: {
      address: (val) => ({
        $or: [{ srcaddr: val }, { dstaddr: val }, { chgaddr: val }]
      }),
      tag: (val) => ({
        $or: [{ srctag: val }, { dsttag: val }, { chgtag: val }]
      })
    }
  }
};

const Interpreter = {
  search: (query, paged, cName) => {
    const results = { query: {}, options: {} };
    if (paged) {
      results.options.skip = 0;
      results.options.limit = 8;
    }
    // remove any preceding '?'
    if (typeof query === 'string' && query) {
      if (query.startsWith('?')) query = query.slice(1);
      const parameters = query.split('&');
      const $and = [];
      // parse search parameters
      for (let param of parameters) {
        const keymodSeparator = param.includes(':') ? ':' : '%3A';
        let [keymod, value] = param.split('=');
        const [key, mod] = keymod.split(keymodSeparator);
        // parse known modifiers, else try parse as number value
        if (mod && Parse.mod[mod]) value = Parse.mod[mod](value);
        else {
          value = isNaN(value) ? value : parseInt(value);
          if (mod) value = { [`$${mod}`]: value };
        }
        // parse known key options
        if (paged && key === 'page' && !isNaN(value)) {
          value = parseInt(value);
          if (value-- > 0 && results.options.limit) {
            results.options.skip = results.options.limit * value;
          }
          continue;
        } else if (paged && key === 'perpage') {
          if (value === 'all') {
            delete results.options.limit;
            delete results.options.skip;
          } else {
            value = parseInt(value);
            if (value > 0) {
              const page = results.options.skip / results.options.limit;
              results.options.limit = value;
              results.options.skip = results.options.limit * page;
            }
          }
          continue;
        }
        // expand special parameters and/or add to $and
        param = {}; // reused...
        if (Parse.special[cName] && Parse.special[cName][key]) {
          param = Parse.special[cName][key](value);
        } else param[key] = value;
        $and.push(param);
      }
      // finally, assign parameters to query
      if ($and.length) Object.assign(results.query, { $and });
    }
    // return final object
    return results;
  }
};

module.exports = Interpreter;
