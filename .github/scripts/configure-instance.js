
/* global shell print dba os */

function getPassword (msg) {
  return shell.prompt(msg, { type: 'password' });
}

print('\n');
print('  InnoDBCluster Instance Configuration\n');
print('  ====================================\n\n');

let clusterAdminPassword, confirmPassword, password;
const clusterAdmin = "'icadmin'@'%'";
const interactive = false;
const restart = true;

do {
  password = getPassword(
    "Please provide the password for 'root@localhost': ");
  try {
    shell.connect({ user: 'root', password, host: 'localhost' });
  } catch (error) {
    print(error.message + '\n\n');
  }
} while (!shell.getSession());
print('Shell connected successfully\n\n');

// get cluster hostname
const clusterHost = shell.prompt('Please enter the address of the cluster: ');
// obtain hostname
const hostname = shell.getSession()
  .runSql('SELECT @@hostname')
  .fetchOneObject()['@@hostname'];

do {
  clusterAdminPassword = getPassword(
    "Please provide a new password for 'icadmin@localhost': ");
  confirmPassword = getPassword(
    "Please confirm the password for 'icadmin@localhost': ");
  if (clusterAdminPassword !== confirmPassword) {
    print('Passwords do not match.\n\n');
  }
} while (!clusterAdminPassword || clusterAdminPassword !== confirmPassword);
print('Password accepted\n\n');

dba.configureInstance('root@localhost:3306', {
  clusterAdmin, clusterAdminPassword, password, interactive, restart
});

print('  Waiting for database to restart...\n');
do {
  try {
    shell.connect({
      user: 'icadmin', password: clusterAdminPassword, host: 'localhost'
    });
  } catch (error) {
    os.sleep(2000);
  }
} while (!shell.getSession());
print('Restart complete!\n\n');

print('Connecting to cluster...');
shell.connect({
  user: clusterAdmin, password: clusterAdminPassword, host: clusterHost
});

// obtain allowlist
let allowlist = shell.getSession()
  .runSql('SELECT @@group_replication_ip_allowlist')
  .fetchOneObject()['@@group_replication_ip_allowlist'];

// split allowlist into array and add hostname
const updatelist = (allowlist || '').split(',');
updatelist.push(hostname);
// create new allowlist (includes hostname)
allowlist = updatelist.join(',');

print('Updating the allowlist for all cluster instances:\n');
while (updatelist.length) {
  const server = updatelist.pop();
  print(`${server}... `);
  try {
    shell.connect({
      user: clusterAdmin, password: clusterAdminPassword, host: server
    }).runSql(`SET PERSIST group_replication_ip_allowlist='${allowlist}'`);
    print('updated\n');
  } catch (error) {
    print(error.message + '\n');
  }
}
print('\n');

print('Adding instance to cluster...');
shell.connect({
  user: clusterAdmin, password: clusterAdminPassword, host: clusterHost
});
dba.getCluster().addInstance(`icadmin@${hostname}`);
