
/* global shell print dba os */

function getPassword (msg) {
  return shell.prompt(msg, { type: 'password' });
}

print('\n');
print('  InnoDBCluster Instance Configuration\n');
print('  ====================================\n\n');

let confirm, password;
const clusterAdmin = "'icadmin'@'%'";
const adminUser = 'icadmin';
const interactive = false;
const restart = true;
const port = 3306;

do {
  try {
    password = getPassword(
      "Please provide the password for 'root@localhost': ");
    confirm = getPassword(
      "Please confirm the password for 'root@localhost': ");
    if (password !== confirm) throw new Error('Passwords do not match');
    shell.connect({ user: 'root', password, host: 'localhost', port });
  } catch (error) {
    print(`${error.message}\n\n`);
  }
} while (!shell.getSession());
print('Shell connected successfully\n\n');

// store hostname for later
const hostname = shell.getSession()
  .runSql('SELECT @@hostname').fetchOneObject()['@@hostname'];
// get cluster hostname
const clusterHost = shell.prompt('Please enter the address of the cluster: ');

dba.configureInstance('root@localhost:3306', {
  clusterAdmin, clusterAdminPassword: password, password, interactive, restart
});

shell.disconnect();
print('  Waiting for database to restart...\n');
os.sleep(5);

do {
  try {
    shell.connect({ user: adminUser, password, host: 'localhost', port });
  } catch (error) {
    os.sleep(2);
  }
} while (!shell.getSession());
print('Restart complete!\n\n');

print('Connecting to cluster...');
shell.connect({ user: adminUser, password, host: clusterHost, port });

// obtain allowlist
let ipAllowlist = shell.getSession()
  .runSql('SELECT @@group_replication_ip_allowlist')
  .fetchOneObject()['@@group_replication_ip_allowlist'];

// split allowlist into array of current members
const updatelist = (ipAllowlist || '').split(',');
// create new allowlist (includes hostname)
ipAllowlist = updatelist.join(',') + `,${hostname}`;

print('Updating the allowlist for all cluster instances:\n');
while (updatelist.length) {
  const server = updatelist.pop();
  print(`${server}... `);
  try {
    shell.connect({ user: adminUser, password, host: server, port })
      .runSql(`SET PERSIST group_replication_ip_allowlist='${ipAllowlist}'`);
    print('updated\n');
  } catch (error) {
    print(error.message + '\n');
  }
}

print('\n');
print('Adding instance to cluster...');
shell.connect({ user: adminUser, password, host: clusterHost, port });
dba.getCluster().addInstance(
  `${adminUser}@${hostname}`, { ipAllowlist, recoveryMethod: 'clone' });
