
/* global shell print dba os */

function getPassword (msg) {
  return shell.prompt(msg, { type: 'password' });
}

print('\n');
print('  InnoDBCluster Setup Configuration\n');
print('  =================================\n\n');

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

// get hostname for ipAllowlist
const ipAllowlist = shell.getSession()
  .runSql('SELECT @@hostname').fetchOneObject()['@@hostname'];
// create the cluster
dba.createCluster('InnoDbCluster', { ipAllowlist });
