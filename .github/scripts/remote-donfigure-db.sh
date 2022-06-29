#!/bin/bash

# check correct usage
if test -z $1; then
   echo "USAGE: $0 <remote_host>"
   exit 1
elif test ! $1 = "localhost"; then
   scp $0 $1:~/
   ssh -t root@$1 $0 "localhost"
else # BEGIN SCRIPT
###################
echo
read -s -p "Provide a new password for 'mochimo'@'localhost': " PASSWD
echo
read -s -p "Confirm the password for 'mochimo'@'localhost': " CONFIRM
echo

if test ! "$PASSWD" = "$CONFIRM"; then
   echo "Passwords DO NOT MATCH! Exiting..."
   exit 1
fi

echo "Please enter the MySQL 'root' password..."
mysql -u root -p -e "
SET PERSIST local_infile = true;
CREATE DATABASE IF NOT EXISTS \`mochimo\`;
CREATE TABLE IF NOT EXISTS \`mochimo\`.\`block\` (
   \`created\` DATETIME NOT NULL,
   \`type\` VARCHAR(12) CHARACTER SET \`ascii\` NOT NULL,
   \`size\` BIGINT UNSIGNED NOT NULL,
   \`difficulty\` INT UNSIGNED NOT NULL,
   \`time\` INT UNSIGNED NOT NULL,
   \`bnum\` BIGINT UNSIGNED NOT NULL,
   \`bhash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`phash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`mroot\` CHAR(64) CHARACTER SET \`ascii\`,
   \`nonce\` CHAR(64) CHARACTER SET \`ascii\`,
   \`maddr\` CHAR(64) CHARACTER SET \`ascii\`,
   \`mreward\` BIGINT UNSIGNED,
   \`mfee\` BIGINT UNSIGNED,
   \`amount\` BIGINT UNSIGNED,
   \`count\` BIGINT UNSIGNED,
   \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
   CONSTRAINT uid_block UNIQUE (\`bnum\`, \`bhash\`),
   INDEX idx_difficulty(\`difficulty\`),
   INDEX idx_bnum(\`bnum\` DESC),
   INDEX idx_bhash(\`bhash\`),
   INDEX idx_maddr(\`maddr\`),
   INDEX idx_mreward(\`mreward\`)
);
CREATE TABLE IF NOT EXISTS \`mochimo\`.\`chain\` (
   \`phash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`bnum\` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
   \`mfee\` BIGINT UNSIGNED NOT NULL,
   \`tcount\` INT UNSIGNED NOT NULL,
   \`time0\` INT UNSIGNED NOT NULL,
   \`difficulty\` INT UNSIGNED NOT NULL,
   \`mroot\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`nonce\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`stime\` INT UNSIGNED NOT NULL,
   \`bhash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL
);
CREATE TABLE IF NOT EXISTS \`mochimo\`.\`ledger\` (
   \`created\` DATETIME NOT NULL,
   \`bnum\` BIGINT UNSIGNED NOT NULL,
   \`bhash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`address\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`addressHash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`tag\` CHAR(24) CHARACTER SET \`ascii\` NOT NULL,
   \`balance\` BIGINT UNSIGNED NOT NULL,
   \`delta\` BIGINT NOT NULL,
   \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
   CONSTRAINT uid_ledger UNIQUE (\`bnum\`, \`bhash\`, \`addressHash\`),
   INDEX idx_bnum(\`bnum\` DESC),
   INDEX idx_bhash(\`bhash\`),
   INDEX idx_address(\`address\`),
   INDEX idx_tag(\`tag\`),
   INDEX idx_balance(\`balance\`)
);
CREATE TABLE IF NOT EXISTS \`mochimo\`.\`richlist\` (
   \`address\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`addressHash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`tag\` CHAR(24) CHARACTER SET \`ascii\` NOT NULL,
   \`balance\` BIGINT UNSIGNED NOT NULL,
   \`rank\` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
   INDEX idx_address(\`address\`),
   INDEX idx_tag(\`tag\`),
   INDEX idx_balance(\`balance\`)
);
CREATE TABLE IF NOT EXISTS \`mochimo\`.\`transaction\` (
   \`created\` DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP),
   \`confirmed\` DATETIME,
   \`bnum\` BIGINT UNSIGNED,
   \`bhash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL DEFAULT '',
   \`txid\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`txsig\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`txhash\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`srcaddr\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`srctag\` CHAR(24) CHARACTER SET \`ascii\` NOT NULL,
   \`dstaddr\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`dsttag\` CHAR(24) CHARACTER SET \`ascii\` NOT NULL,
   \`chgaddr\` CHAR(64) CHARACTER SET \`ascii\` NOT NULL,
   \`chgtag\` CHAR(24) CHARACTER SET \`ascii\` NOT NULL,
   \`sendtotal\` BIGINT UNSIGNED NOT NULL,
   \`changetotal\` BIGINT UNSIGNED NOT NULL,
   \`txfee\` BIGINT UNSIGNED NOT NULL,
   \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
   CONSTRAINT uid_transaction UNIQUE (\`txhash\`, \`bhash\`),
   INDEX idx_bnum(\`bnum\` DESC),
   INDEX idx_txid (\`txid\`),
   INDEX idx_srcaddr(\`srcaddr\`),
   INDEX idx_srctag(\`srctag\`),
   INDEX idx_dstaddr(\`dstaddr\`),
   INDEX idx_dsttag(\`dsttag\`),
   INDEX idx_chgaddr(\`chgaddr\`),
   INDEX idx_chgtag(\`chgtag\`),
   INDEX idx_sendtotal(\`sendtotal\`),
   INDEX idx_changetotal(\`changetotal\`)
);
CREATE USER IF NOT EXISTS 'mochimo'@'localhost' IDENTIFIED by '$PASSWD';
GRANT CREATE TEMPORARY TABLES ON \`mochimo\`.* TO 'mochimo'@'localhost';
GRANT INSERT, SELECT ON \`mochimo\`.* TO 'mochimo'@'localhost';
GRANT DELETE, UPDATE ON \`mochimo\`.\`richlist\` TO 'mochimo'@'localhost';
GRANT UPDATE ON \`mochimo\`.\`transaction\` TO 'mochimo'@'localhost';
FLUSH PRIVILEGES;
";
# report success of command
if test $? -eq 0; then echo "SUCCESS!"; else echo "FAILURE!!!"; fi
############
# END SCRIPT
fi
