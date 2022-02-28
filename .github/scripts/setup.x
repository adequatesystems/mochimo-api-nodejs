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

# configure database tables and mochimo user
mysqlsh -f ~/mochimo-api-nodejs/.github/scripts/configure-mysql.js

# (re)Install environment variables
rm -f ~/mochimo-api-nodejs/.env
echo
echo "  Please enter your Mochimo API env vars (as necessary)..."
echo "NODEIP=$(hostname -I)" >> ~/mochimo-api-nodejs/.env
echo
read -s -p "MySQL password for 'mochimo@localhost': " DBPASS
echo "DBPASS=$DBPASS" >> ~/mochimo-api-nodejs/.env
unset DBPASS
echo
read -p 'IPInfo.io Access Token: ' IPINFOTOKEN
echo "IPINFOTOKEN=$IPINFOTOKEN" >> ~/mochimo-api-nodejs/.env
unset IPINFOTOKEN
echo

# Install dependencies and setup pm2 startup
cd ~/mochimo-api-nodejs/ && \
  npm install && npm run pm2setup && npm run pm2startup

echo
echo "  ===================================="
echo "  Mochimo API (Nodejs) Setup Complete!"
echo "  ===================================="
echo
