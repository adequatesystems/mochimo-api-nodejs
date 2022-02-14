#!/bin/bash

# existing installation check
cd ~/mochimo-api-nodejs || \
( echo "  Error: no existing Mochimo API (Nodejs) installation" && \
  echo "  Exiting..." && exit )

THISHOST=$(hostname -b)
THISIP=$(hostname -I | awk '{print $1;}')

  echo
  echo "WARNING: BEFORE YOU CONTINUE..."
  echo "  To ensure every server in the cluster can identify this server,"
  echo "  add the following IP and Hostname to /etc/hosts on every server"
  echo "  that is to be, or is already, an instance of the cluster:"
  echo
  echo "    $THISIP $THISHOST"
  echo
  echo "  Likewise, add similar information of every other server in the"
  echo "  cluster to /etc/hosts on THIS server before continuing."
  echo
  read -p 'Ctrl+C to Abort. Press enter to continue...'
  read -p 'Will this server be added to an existing cluster? (y|n):' REMOTE
if test "$REMOTE" = "y"; then
  read -p 'Please enter an address of the existing cluster:' REMOTEHOST
fi
  echo

# ensure latest copy of repository
git pull
# install MySQL Router
apt install -y mysql-router
# add hostname to localhost
( grep -q -E "^127.0.0.1 localhost.*$" /etc/hosts && \
  sed -i -E "s/^127.0.0.1 localhost.*$/127.0.0.1 localhost $(hostname)/g" \
  /etc/hosts || echo "127.0.0.1 localhost $THISHOST" >> /etc/hosts )

# execute configuration script for cluster or instance
if test "$REMOTE" = "y"; then
  mysql -u root -p -e "SET PERSIST group_replication_ip_allowlist=$REMOTEHOST"
  mysqlsh -f .github/scripts/configure-instance.js
  mysqlrouter --user root --bootstrap icadmin@localhost:3306 \
    --conf-use-sockets --account icrouter
else
  mysqlsh -f .github/scripts/configure-cluster.js
  mysqlrouter --user root --bootstrap icadmin@localhost:3306 \
    --conf-use-sockets --account icrouter --account-create always
fi

# install mysqlrouter service
cat <<EOF >/etc/systemd/system/mysqlrouter.service
[Unit]
Description=MySql Application Router
After=network.target
[Service]
ExecStart=mysqlrouter
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mysqlrouter.service
systemctl restart mysqlrouter.service
fi

# update environment vars with router ports
echo "DBPORT_RW=6446" >> .env
echo "DBPORT_RO=6447" >> .env

# restart api
npm install && npm run pm2startup

echo
echo "  ========================================"
echo "  Mochimo API (Nodejs) Cluster Configured!"
echo "  ========================================"
echo
