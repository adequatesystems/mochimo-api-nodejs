#!/bin/bash

# install/update Mochimo node (FIRST so it has time to boot)
bash <(curl -sL \
  https://github.com/mochimodev/mochimo/raw/master/.github/scripts/setup.x)

  echo
if test -d ~/mochimo-api-nodejs; then
  echo "  Existing API (nodejs) installation detected..."
  echo "  Performing an update of installed Mochimo API (Nodejs)"
  echo
  cd ~/mochimo-api-nodejs && git pull
  npm stop && npm install && npm run pm2startup
  echo
  echo "  Mochimo API (Nodejs) update complete!"
  echo
  exit
fi

# ensure default system apache service is disabled
systemctl stop apache2 && systemctl disable apache2
# prepare apt configuration for Nodejs LTS (latest)
curl -sL https://deb.nodesource.com/setup_lts.x | bash -
# prepare apt configuration for MySQL 8.0.28
curl -OL https://dev.mysql.com/get/mysql-apt-config_0.8.22-1_all.deb
DEBIAN_FRONTEND=noninteractive dpkg -i mysql-apt-config*
rm mysql-apt-config*
# update, upgrade and install MySQL dependencies
apt update && apt install -y git nodejs mysql-server mysql-shell
# configure MySQL secure installation
mysql_secure_installation

# install Mochimo API components, env vars and dependencies
git clone --single-branch \
  https://github.com/adequatesystems/mochimo-api-nodejs ~/mochimo-api-nodejs
cd ~/mochimo-api-nodejs &&

# configure database tables and mochimo user
mysqlsh -f ./github/scripts/configure-mysql.js

# (re)Install environment variables
rm -f .env
echo
echo "  Please enter your Mochimo API (Nodejs) environment variables..."
echo "    (or press enter to leave blank)"
read -p 'IPInfo.io Access Token: ' IPINFOTOKEN
echo "IPINFOTOKEN=$IPINFOTOKEN" >> .env
unset IPINFOTOKEN
read -s -p "MySQL password for 'mochimo@localhost': " DBPASS
echo "DBPASS=$DBPASS" >> .env
unset DBPASS

# Install dependencies and setup pm2 startup
npm install && npm run pm2setup && npm run pm2startup

echo
echo "  ===================================="
echo "  Mochimo API (Nodejs) Setup Complete!"
echo "  ===================================="
echo
