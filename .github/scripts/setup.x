#!/bin/bash
echo

# check for existing API installation
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
# git clone Mochimo API component
git clone https://github.com/adequatesystems/mochimo-api-nodejs ~/mochimo-api-nodejs
# (re)Install environment variables
rm -f ~/mochimo-api-nodejs/.env
echo
echo "  Please enter the following Mochimo API env vars..."
read -p 'IPInfo.io Access Token [blank]: ' IPINFOTOKEN
read -s -p "MySQL password for 'mochimo@localhost': " DBPASS
echo "IPINFOTOKEN=$IPINFOTOKEN" >> ~/mochimo-api-nodejs/.env
echo "DBPASS=$DBPASS" >> ~/mochimo-api-nodejs/.env
unset IPINFOTOKEN
unset DBPASS
echo
# Install package dependencies and setup pm2 startup
cd ~/mochimo-api-nodejs && npm install && npm run pm2setup && npm run pm2startup
echo
echo "  ===================================="
echo "  Mochimo API (Nodejs) Setup Complete!"
echo "  ===================================="
echo
