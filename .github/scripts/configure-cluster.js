
/* global shell print dba os */

function getPassword (msg) {
  return shell.prompt(msg, { type: 'password' });
}

print('\n');
print('  InnoDBCluster Setup Configuration\n');
print('  =================================\n\n');

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
    os.sleep(2);
  }
} while (!shell.getSession());
print('Restart complete!\n\n');

// get hostname (as specified by system) and place in allowedlist
shell.getSession()
  .runSql('SET PERSIST group_replication_ip_allowlist=(SELECT @@hostname)');
