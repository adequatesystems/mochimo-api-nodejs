#!/bin/bash

# check correct usage
if test -z $1; then
   echo "USAGE: $0 <remote_host>"
   exit 1
elif test ! $1 = "localhost"; then
   scp $0 $1:~/
   ssh -t root@$1 $0 "localhost"
else # BEGIN SCRIPT
###################
echo -e "\n\tChecking Mochimo Node Installation...\n"
bash <(curl -sL mochimo.org/setup/node/dev)
echo -e "\n\tChecking Mochimo API Installation...\n"
bash <(curl -sL https://github.com/adequatesystems/mochimo-api-nodejs/raw/main/.github/scripts/setup.x)
############
# END SCRIPT
fi
