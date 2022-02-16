#!/bin/bash

# existing installation check
cd ~/mochimo-api-nodejs || \
( echo "  Error: no existing Mochimo API (Nodejs) installation" && \
  echo "  Exiting..." && exit )

THISHOST=$(hostname -b)
THISIP=$(hostname -I | awk '{print $1;}')

  echo
  echo "WARNING: BEFORE YOU CONTINUE..."
  echo
  echo "  To ensure every server in the cluster can identify this server,"
  echo "  add the following IP and Hostname to /etc/hosts on every server"
  echo "  that is to be, or is already, an instance of the cluster:"
  echo
  echo "    $THISIP $THISHOST"
  echo
  echo "  Likewise, add the ip/hostname information of every other server"
  echo "  in the cluster to /etc/hosts on THIS server before continuing."
  echo
  echo "  Additionally, and if enabled, ensure your firewall will accept"
  echo "  incoming connections from every server in the cluster, to port"
  echo "  3306 and 33061. For example:"
  echo
  echo "  ufw allow from $THISIP to any port 3306,33060,33061 proto tcp"
  echo
  echo "WARNING: By continuing, you acknowledge the prerequisites above."
  echo
  read -p 'Ctrl+C to Abort. Press enter to continue...'
  echo
  read -p 'Are you adding to an existing cluster? (y|n): ' CLUSTER
  echo

# ensure latest copy of repository
git pull
# install MySQL Router
apt install -y mysql-router
# add hostname to localhost
( grep -q -E "^127.0.0.1\slocalhost.*$" /etc/hosts && \
  sed -i -E "s/^127.0.0.1\slocalhost.*$/127.0.0.1 localhost $(hostname)/g" \
  /etc/hosts || echo "127.0.0.1 localhost $THISHOST" >> /etc/hosts )

# execute configuration script for cluster or instance
if test "$CLUSTER" = "y"; then
  mysqlsh -f .github/scripts/configure-instance.js
else
  mysqlsh -f .github/scripts/configure-cluster.js
fi

echo "NOTE: MySQL password for 'icadmin' and 'root' are likely the same."
echo "If you decide to change this, (re)run MySQL Router bootstrap with:"
echo "  'mysqlrouter --bootstrap icadmin@localhost:3306 --conf-use-sockets --account icrouter'"
echo
mysqlrouter --user root --bootstrap icadmin@localhost:3306 \
  --conf-use-sockets --account icrouter

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

# update environment vars with router ports
echo "DBPORT_RW=6446" >> .env
echo "DBPORT_RO=6447" >> .env

# restart api
npm install && npm restart

echo
echo "  ========================================"
echo "  Mochimo API (Nodejs) Cluster Configured!"
echo "  ========================================"
echo
