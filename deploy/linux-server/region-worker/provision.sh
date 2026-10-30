#!/bin/bash
# Provision a fresh Ubuntu 24.04 box as a DR Linux+Wine game worker (same stack as the Singapore box).
#   git clone https://github.com/ZFXSTATIC/dauntless-revived.git /opt/dr-src && git -C /opt/dr-src checkout au-region
#   sudo /opt/dr-src/deploy/linux-server/region-worker/provision.sh --my-ip <public ip> --deploy-port 61071 --allow-port 61055 --max-hunts 16
# Per-box secrets (fleet key, allowlist secret, METAGAME_API_KEY) are generated or filled on the box and never go in git.
set -euo pipefail
MY_IP= DEPLOY_PORT= ALLOW_PORT= MAX_HUNTS=16 MAIN=82.153.118.176 REF=au-region
while [ $# -gt 0 ]; do case "$1" in
  --my-ip) MY_IP=$2; shift 2;; --deploy-port) DEPLOY_PORT=$2; shift 2;; --allow-port) ALLOW_PORT=$2; shift 2;;
  --max-hunts) MAX_HUNTS=$2; shift 2;; --main) MAIN=$2; shift 2;; --ref) REF=$2; shift 2;; *) echo "bad arg $1" >&2; exit 2;; esac; done
[ -n "$MY_IP" ] && [ -n "$DEPLOY_PORT" ] && [ -n "$ALLOW_PORT" ] || { echo "need --my-ip --deploy-port --allow-port" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
SRC=/opt/dr-src; IR=/opt/dauntless-revived; HERE=$SRC/deploy/linux-server/region-worker
G=/srv/dauntless/BaseGame144/Dauntless
# some provider resolvers cannot resolve the game CDN (AU box): add public resolvers
if ! getent hosts downloads.epcr.lol >/dev/null; then
  mkdir -p /etc/systemd/resolved.conf.d; printf '[Resolve]
DNS=1.1.1.1 8.8.8.8
' > /etc/systemd/resolved.conf.d/dr-dns.conf; systemctl restart systemd-resolved
fi
dpkg --add-architecture i386; apt-get update -qq
apt-get install -y -qq wine wine64 wine32:i386 xvfb nftables git curl ca-certificates python3 ufw openssl >/dev/null
if ! command -v node >/dev/null || ! node -e 'process.exit(+process.versions.node.split(".")[0]<22)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null; apt-get install -y -qq nodejs >/dev/null; fi
[ -e /usr/local/bin/node ] || ln -s "$(command -v node)" /usr/local/bin/node
git -C $SRC fetch -q origin; git -C $SRC checkout -q --force "origin/$REF"
mkdir -p $IR /opt/dr-worker /etc/dr-worker /var/lib/dr-worker/ready /var/log/dr-worker $G
(cd $SRC && tar --exclude=.git --exclude="*/node_modules" --exclude="*/dist" --exclude="*/build" -cf - deploy UndauntedLauncher/assets) | (cd $IR && tar -xf -)
chmod +x $IR/deploy/linux-server/worker-launch.mjs $IR/deploy/linux-server/ssh-worker-command.sh
id drworker >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/dauntless-revived-worker --shell /usr/sbin/nologin drworker
mkdir -p /var/lib/dauntless-revived-worker/proton
chown -R drworker:drworker /var/lib/dauntless-revived-worker /var/lib/dr-worker /var/log/dr-worker
python3 $HERE/fetch-game.py $G/   # hash-checks every file against the R2 mirror (dr-dl.afterlifeinteractive.com); files already copied from another worker are kept if they match
$IR/deploy/linux-server/prepare-game.sh --game-dir $G --repo $IR
chmod -R a+rX /srv/dauntless
cat > /etc/dauntless-revived-worker.env <<EOT
DR_GAME_EXE=$G/Archon/Binaries/Win64/Dauntless-Win64-Shipping.exe
DR_PROTON_BINARY=
DR_PROTON_COMPAT_DATA=/var/lib/dauntless-revived-worker/proton
DR_WINE_BINARY=/usr/lib/wine/wine64
DR_WINEPREFIX=/var/lib/dauntless-revived-worker/wineprefix
WINEDEBUG=-all
WINEDLLOVERRIDES=dxgi=n,b
DR_XVFB=0
DISPLAY=:99
EOT
chown root:drworker /etc/dauntless-revived-worker.env; chmod 640 /etc/dauntless-revived-worker.env
ln -sf $IR/deploy/linux-server/ssh-worker-command.sh /usr/local/bin/dr-game-worker
install -m 755 $HERE/gameserver.sh /opt/dr-worker/gameserver.sh
# fleet key for the tunnels to MAIN; the public half goes into MAIN's dauntless authorized_keys
[ -f /etc/dr-worker/fleet_ed25519 ] || { ssh-keygen -q -t ed25519 -N "" -C "ZFXSTATIC-dr-$(hostname)-$(date +%F)" -f /etc/dr-worker/fleet_ed25519; chown drworker:drworker /etc/dr-worker/fleet_ed25519*; }
ssh-keyscan -t ed25519 $MAIN 2>/dev/null > /etc/dr-worker/known_hosts; chmod 644 /etc/dr-worker/known_hosts
[ -f /etc/dr-worker/allowlist.env ] || sed "s/@ALLOW_SECRET@/$(openssl rand -hex 24)/" $HERE/allowlist.env.example > /etc/dr-worker/allowlist.env
[ -f /etc/dr-worker/deploy.env ] || sed "s/@MY_IP@/$MY_IP/;s/@MAX_HUNTS@/$MAX_HUNTS/" $HERE/deploy.env.example > /etc/dr-worker/deploy.env
chown root:drworker /etc/dr-worker/*.env; chmod 640 /etc/dr-worker/*.env
for u in dr-xvfb dr-worker-deploy dr-worker-allowlist dr-worker-tunnel dr-worker-tunnel-rev; do
  sed "s/@MAIN@/$MAIN/g;s/@DEPLOY_PORT@/$DEPLOY_PORT/g;s/@ALLOW_PORT@/$ALLOW_PORT/g" $HERE/systemd/$u.service > /etc/systemd/system/$u.service; done
systemctl daemon-reload; systemctl enable --now dr-xvfb; sleep 2
[ -d /var/lib/dauntless-revived-worker/wineprefix ] || sudo -u drworker env HOME=/var/lib/dauntless-revived-worker WINEPREFIX=/var/lib/dauntless-revived-worker/wineprefix WINEDEBUG=-all DISPLAY=:99 /usr/lib/wine/wine64 wineboot --init >/tmp/wineboot.log 2>&1 || true
# warm the Wine prefix with the game binary once: the very first hunt launch on a cold prefix exits with code 1
sudo -u drworker env HOME=/var/lib/dauntless-revived-worker WINEPREFIX=/var/lib/dauntless-revived-worker/wineprefix WINEDEBUG=-all DISPLAY=:99 WINEDLLOVERRIDES=dxgi=n,b timeout 40 /usr/lib/wine/wine64 $G/Archon/Binaries/Win64/Dauntless-Win64-Shipping.exe >/dev/null 2>&1 || true
install -m 644 $HERE/ssh-key-only.conf /etc/ssh/sshd_config.d/01-key-only.conf   # key-only SSH (new boxes get password-guessing at once)
sshd -t && systemctl reload ssh
ufw allow 22/tcp >/dev/null; ufw allow 8700:8775/udp >/dev/null; ufw allow 8800:8810/udp >/dev/null; ufw --force enable >/dev/null
# the allowlist helper loads the gateway's built ip.js
(cd $SRC/UndauntedGateway && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null && mkdir -p $IR/UndauntedGateway && cp -r dist package.json $IR/UndauntedGateway/)
sh $IR/deploy/linux-server/deploy-worker.sh --ref "$REF" --force || true
echo "PUBKEY for MAIN (user dauntless):"; cat /etc/dr-worker/fleet_ed25519.pub
echo "PROVISION-DONE: fill METAGAME_API_KEY in /etc/dr-worker/deploy.env, add the key on MAIN, then enable the dr-worker-* units"
