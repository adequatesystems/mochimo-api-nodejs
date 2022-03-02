
/* global shell print */

function getPassword (msg) {
  return shell.prompt(msg, { type: 'password' });
}

print('\n');
print('  MySQL Database Configuration\n');
print('  ============================\n\n');

let confirmPassword, password;
const port = 3306;

do {
  password = getPassword(
    "Please provide the password for 'root@localhost': ");
  try {
    shell.connect({ user: 'root', password, host: 'localhost', port });
  } catch (error) {
    print(error.message + '\n\n');
  }
} while (!shell.getSession());

print('Setting global configuration...\n\n');
shell.getSession().runSql('SET PERSIST local_infile = true');
shell.getSession().runSql('SET PERSIST max_connections = 999');

print('Creating databases and tables...\n\n');
shell.getSession().runSql('CREATE DATABASE `mochimo`');
shell.getSession().runSql('use `mochimo`');
shell.getSession().runSql(
  'CREATE TABLE `block` (' +
    '`created` DATETIME NOT NULL, ' +
    '`time` INT NOT NULL, ' +
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
    '`count` BIGINT UNSIGNED, ' +
    '`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ' +
    'CONSTRAINT uid_block UNIQUE (`bnum`, `bhash`), ' +
    'INDEX idx_difficulty(`difficulty`), ' +
    'INDEX idx_bnum(`bnum` DESC), ' +
    'INDEX idx_bhash(`bhash`), ' +
    'INDEX idx_maddr(`maddr`), ' +
    'INDEX idx_mreward(`mreward`)' +
  ')'
);
/** SQL
CREATE TABLE `block` (
  `created` DATETIME NOT NULL,
  `time` INT NOT NULL,
  `type` VARCHAR(12) NOT NULL,
  `size` BIGINT UNSIGNED NOT NULL,
  `difficulty` INT UNSIGNED NOT NULL,
  `bnum` BIGINT UNSIGNED NOT NULL,
  `bhash` CHAR(64) NOT NULL,
  `phash` CHAR(64) NOT NULL,
  `mroot` CHAR(64),
  `nonce` CHAR(64),
  `maddr` CHAR(64),
  `mreward` BIGINT UNSIGNED,
  `mfee` BIGINT UNSIGNED,
  `amount` BIGINT UNSIGNED,
  `count` BIGINT UNSIGNED,
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  CONSTRAINT uid_block UNIQUE (`bnum`, `bhash`),
  INDEX idx_difficulty(`difficulty`),
  INDEX idx_bnum(`bnum` DESC),
  INDEX idx_bhash(`bhash`),
  INDEX idx_maddr(`maddr`),
  INDEX idx_mreward(`mreward`)
)
 */
shell.getSession().runSql(
  'CREATE TABLE `neogen` (' +
    '`created` DATETIME NOT NULL, ' +
    '`bnum` BIGINT UNSIGNED NOT NULL, ' +
    '`bhash` CHAR(64) NOT NULL, ' +
    '`address` CHAR(64) NOT NULL, ' +
    '`addressHash` CHAR(64) NOT NULL, ' +
    '`tag` CHAR(24) NOT NULL, ' +
    '`balance` BIGINT UNSIGNED NOT NULL, ' +
    '`delta` BIGINT NOT NULL, ' +
    '`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ' +
    'CONSTRAINT uid_address UNIQUE (`bnum`, `bhash`, `addressHash`), ' +
    'INDEX idx_bnum(`bnum` DESC), ' +
    'INDEX idx_bhash(`bhash`), ' +
    'INDEX idx_address(`address`), ' +
    'INDEX idx_tag(`tag`), ' +
    'INDEX idx_balance(`balance`)' +
  ')'
);
/** SQL
CREATE TABLE `neogen` (
  `created` DATETIME NOT NULL,
  `bnum` BIGINT UNSIGNED NOT NULL,
  `bhash` CHAR(64) NOT NULL,
  `address` CHAR(64) NOT NULL,
  `addressHash` CHAR(64) NOT NULL,
  `tag` CHAR(24) NOT NULL,
  `balance` BIGINT UNSIGNED NOT NULL,
  `delta` BIGINT NOT NULL,
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  CONSTRAINT uid_address UNIQUE (`bnum`, `bhash`, `addressHash`),
  INDEX idx_bnum(`bnum` DESC),
  INDEX idx_bhash(`bhash`),
  INDEX idx_address(`address`),
  INDEX idx_tag(`tag`),
  INDEX idx_balance(`balance`)
)
 */
shell.getSession().runSql(
  'CREATE TABLE `richlist` (' +
    '`address` CHAR(64) NOT NULL, ' +
    '`addressHash` CHAR(64) NOT NULL, ' +
    '`tag` CHAR(24) NOT NULL, ' +
    '`balance` BIGINT UNSIGNED NOT NULL, ' +
    '`rank` BIGINT UNSIGNED NOT NULL PRIMARY KEY, ' +
    'INDEX idx_address(`address`), ' +
    'INDEX idx_tag(`tag`), ' +
    'INDEX idx_balance(`balance`)' +
  ')'
);
/** SQL
CREATE TABLE `richlist` (
  `address` CHAR(64) NOT NULL,
  `addressHash` CHAR(64) NOT NULL,
  `tag` CHAR(24) NOT NULL,
  `balance` BIGINT UNSIGNED NOT NULL,
  `rank` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  INDEX idx_address(`address`),
  INDEX idx_tag(`tag`),
  INDEX idx_balance(`balance`)
)
 */
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
    '`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ' +
    'CONSTRAINT uid_transaction UNIQUE (`txid`, `bhash`), ' +
    'INDEX idx_bnum(`bnum` DESC), ' +
    'INDEX idx_txid (`txid`), ' +
    'INDEX idx_srcaddr(`srcaddr`), ' +
    'INDEX idx_srctag(`srctag`), ' +
    'INDEX idx_dstaddr(`dstaddr`), ' +
    'INDEX idx_dsttag(`dsttag`), ' +
    'INDEX idx_chgaddr(`chgaddr`), ' +
    'INDEX idx_chgtag(`chgtag`), ' +
    'INDEX idx_sendtotal(`sendtotal`), ' +
    'INDEX idx_changetotal(`changetotal`)' +
  ')'
);
/** SQL
FIELDS (`created`, `confirmed`, `bnum`, `bhash`, `txid`, `txsig`, `srcaddr`, `srctag`, `dstaddr`, `dsttag`, `chgaddr`, `chgtag`, `sendtotal`, `changetotal`, `txfee`)
CREATE TABLE `transaction` (
  `created` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
  `confirmed` DATETIME,
  `bnum` BIGINT UNSIGNED,
  `bhash` CHAR(64),
  `txid` CHAR(64) NOT NULL,
  `txsig` CHAR(64) NOT NULL,
  `srcaddr` CHAR(64) NOT NULL,
  `srctag` CHAR(24) NOT NULL,
  `dstaddr` CHAR(64) NOT NULL,
  `dsttag` CHAR(24) NOT NULL,
  `chgaddr` CHAR(64) NOT NULL,
  `chgtag` CHAR(24) NOT NULL,
  `sendtotal` BIGINT UNSIGNED NOT NULL,
  `changetotal` BIGINT UNSIGNED NOT NULL,
  `txfee` BIGINT UNSIGNED NOT NULL,
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  CONSTRAINT uid_transaction UNIQUE (`txid`, `bhash`),
  INDEX idx_bnum(`bnum` DESC),
  INDEX idx_txid (`txid`),
  INDEX idx_srcaddr(`srcaddr`),
  INDEX idx_srctag(`srctag`),
  INDEX idx_dstaddr(`dstaddr`),
  INDEX idx_dsttag(`dsttag`),
  INDEX idx_chgaddr(`chgaddr`),
  INDEX idx_chgtag(`chgtag`),
  INDEX idx_sendtotal(`sendtotal`),
  INDEX idx_changetotal(`changetotal`)
);
 */

do {
  password = getPassword(
    "Please provide a new password for 'mochimo'@'%': ");
  confirmPassword = getPassword(
    "Please confirm the password for 'mochimo'@'%'': ");
  if (password !== confirmPassword) {
    print('Passwords do not match.\n\n');
  }
} while (!password || password !== confirmPassword);
print('Password accepted\n\n');

shell.getSession().runSql(
  "CREATE USER 'mochimo'@'%' IDENTIFIED by '" + password + "'");
shell.getSession().runSql(
  'GRANT SELECT ON `performance_schema`.`replication_group_members`' +
  " TO 'mochimo'@'%'");
shell.getSession().runSql(
  "GRANT CREATE TEMPORARY TABLES ON `mochimo`.* TO 'mochimo'@'%'");
shell.getSession().runSql(
  "GRANT INSERT, SELECT, ON `mochimo`.* TO 'mochimo'@'%'");
shell.getSession().runSql(
  "GRANT DELETE ON `mochimo`.`richlist` TO 'mochimo'@'%'");
shell.getSession().runSql(
  "GRANT UPDATE ON `mochimo`.`transaction` TO 'mochimo'@'%'");
shell.getSession().runSql(
  'FLUSH PRIVILEGES');
