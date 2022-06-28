#!/bin/bash

  echo
if test -d ~/mochimo-api-nodejs; then
  echo "  Existing API (nodejs) installation detected..."
  echo "  Performing an update of installed Mochimo API (Nodejs)"
  echo
  cd ~/mochimo-api-nodejs && git pull
  npm stop && npm install && npm run pm2startup
  echo
  echo "  ====================================="
  echo "  Mochimo API (Nodejs) Update Complete!"
  echo "  ====================================="
  echo
  exit
fi

# ensure default system apache service is disabled
systemctl stop apache2 && systemctl disable apache2
# prepare apt configuration for Nodejs LTS (latest)
curl -sL https://deb.nodesource.com/setup_lts.x | bash -
# update and install git/nodejs
apt update && apt install -y git nodejs

# install Mochimo API components, env vars and dependencies
git clone --single-branch \
  https://github.com/adequatesystems/mochimo-api-nodejs ~/mochimo-api-nodejs

# (re)Install environment variables
rm -f ~/mochimo-api-nodejs/.env
echo
echo "  Please enter your Mochimo API env vars (as necessary)..."
read -p 'IPInfo.io Access Token: ' IPINFOTOKEN
read -s -p "MySQL password for 'mochimo@localhost': " DBPASS
echo "NODEIP=$(hostname -I)" >> ~/mochimo-api-nodejs/.env
echo "IPINFOTOKEN=$IPINFOTOKEN" >> ~/mochimo-api-nodejs/.env
echo "DBPASS=$DBPASS" >> ~/mochimo-api-nodejs/.env
unset IPINFOTOKEN
unset DBPASS
echo

# Install package dependencies and setup pm2 startup
cd ~/mochimo-api-nodejs/ && \
  npm install && npm run pm2setup && npm run pm2startup

echo
echo "  ===================================="
echo "  Mochimo API (Nodejs) Setup Complete!"
echo "  ===================================="
echo
