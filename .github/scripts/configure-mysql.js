
/* global shell print */

function getPassword (msg) {
  return shell.prompt(msg, { type: 'password' });
}

let confirmPassword, password;

do {
  password = getPassword(
    "Please provide the password for 'root@localhost': ");
  try {
    shell.connect({ user: 'root', password, host: 'localhost' });
  } catch (error) {
    print(error.message + '\n\n');
  }
} while (!shell.getSession());

print('Creating database tables...\n\n');
shell.getSession().runSql('CREATE DATABASE `mochimo`');
shell.getSession().runSql('use `mochimo`');
shell.getSession().runSql(
  'CREATE TABLE `balance` (' +
    '`created` DATETIME NOT NULL, ' +
    '`bnum` CHAR(64) NOT NULL, ' +
    '`bhash` CHAR(64) NOT NULL, ' +
    '`address` CHAR(64) NOT NULL, ' +
    '`addressHash` CHAR(64) NOT NULL, ' +
    '`tag` CHAR(24) NOT NULL, ' +
    '`balance` BIGINT UNSIGNED NOT NULL, ' +
    '`delta` BIGINT NOT NULL, ' +
    'PRIMARY KEY (`bnum`, `bhash`, `addressHash`), ' +
    'INDEX idx_tag(`tag`), ' +
    'INDEX idx_balance(`balance`)' +
  ')'
);
shell.getSession().runSql(
  'CREATE TABLE `block` (' +
    '`created` DATETIME NOT NULL, ' +
    '`started` DATETIME NOT NULL, ' +
    '`type` VARCHAR(12) NOT NULL, ' +
    '`size` BIGINT UNSIGNED NOT NULL, ' +
    '`difficulty` INT UNSIGNED NOT NULL, ' +
    '`bnum` BIGINT UNSIGNED NOT NULL, ' +
    '`bhash` CHAR(64) NOT NULL, ' +
    '`phash` CHAR(64) NOT NULL, ' +
    '`mroot` CHAR(64), ' +
    '`nonce` CHAR(64), ' +
    '`maddr` CHAR(64), ' +
    '`mreward` BIGINT UNSIGNED, ' +
    '`mfee` BIGINT UNSIGNED, ' +
    '`amount` BIGINT UNSIGNED, ' +
    '`tcount` BIGINT UNSIGNED, ' +
    '`lcount` BIGINT UNSIGNED, ' +
    'PRIMARY KEY (`bnum`, `bhash`), ' +
    'INDEX idx_created(`created`), ' +
    'INDEX idx_started(`started`) ' +
  ')'
);
shell.getSession().runSql(
  'CREATE TABLE `richlist` (' +
    '`address` CHAR(64) NOT NULL, ' +
    '`addressHash` CHAR(64) NOT NULL, ' +
    '`tag` CHAR(24) NOT NULL, ' +
    '`balance` BIGINT UNSIGNED NOT NULL, ' +
    '`rank` BIGINT UNSIGNED NOT NULL PRIMARY KEY ' +
  ')'
);
shell.getSession().runSql(
  'CREATE TABLE `transaction` (' +
    '`created` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP), ' +
    '`confirmed` DATETIME, ' +
    '`bnum` BIGINT UNSIGNED, ' +
    '`bhash` CHAR(64), ' +
    '`txid` CHAR(64) NOT NULL, ' +
    '`txsig` CHAR(64) NOT NULL, ' +
    '`srcaddr` CHAR(64) NOT NULL, ' +
    '`srctag` CHAR(24) NOT NULL, ' +
    '`dstaddr` CHAR(64) NOT NULL, ' +
    '`dsttag` CHAR(24) NOT NULL, ' +
    '`chgaddr` CHAR(64) NOT NULL, ' +
    '`chgtag` CHAR(24) NOT NULL, ' +
    '`sendtotal` BIGINT UNSIGNED NOT NULL, ' +
    '`changetotal` BIGINT UNSIGNED NOT NULL, ' +
    '`txfee` BIGINT UNSIGNED NOT NULL, ' +
    'PRIMARY KEY (`txid`, `txsig`), ' +
    'INDEX idx_created(`created`), ' +
    'INDEX idx_bnum(`bnum`), ' +
    'INDEX idx_srctag(`srctag`), ' +
    'INDEX idx_dsttag(`dsttag`), ' +
    'INDEX idx_chgtag(`chgtag`)' +
  ')'
);

do {
  password = getPassword(
    "Please provide a new password for 'mochimo@localhost': ");
  confirmPassword = getPassword(
    "Please confirm the password for 'mochimo@localhost': ");
  if (password !== confirmPassword) {
    print('Passwords do not match.\n\n');
  }
} while (!password || password !== confirmPassword);
print('Password accepted\n\n');

shell.getSession().runSql(
  "CREATE USER 'mochimo'@'%' IDENTIFIED by '" + password + "'");
shell.getSession().runSql(
  "GRANT INSERT, SELECT, UPDATE ON mochimo.* TO 'mochimo'@'%'");
shell.getSession().runSql(
  "GRANT DELETE ON mochimo.richlist TO 'mochimo'@'%'");
shell.getSession().runSql('FLUSH PRIVILEGES');
