#!/bin/bash
P=$(/usr/local/bin/node -e 'console.log(Buffer.from(JSON.stringify(process.argv.slice(1))).toString("base64url"))' -- "$@")
exec /usr/local/bin/node /opt/dauntless-revived/deploy/linux-server/worker-launch.mjs "$P"
