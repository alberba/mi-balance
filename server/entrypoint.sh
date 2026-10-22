#!/bin/sh
set -eu
./node_modules/.bin/auth migrate --yes
node scripts/bootstrap.js
exec node app/server.js
