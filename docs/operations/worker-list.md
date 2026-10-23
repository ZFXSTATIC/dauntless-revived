# Adding a game worker without a restart

The main deploy server sends hunts, Ramsgate and Training for the `us` and `ger` regions to workers over
loopback SSH tunnels. A region can have several workers. They are tried in order, and the next one is used only
when the previous one refuses for capacity. A timeout or a reset is never retried on another worker, so a hunt is
never started twice.

## workers.json

Copy `UndauntedDeployServer/workers.example.json` to `data/config/workers.json` on the main host (or set
`WORKERS_FILE`). For each region:

- `urls`: the tunnel of each worker, `http://127.0.0.1:<port>`. Only loopback URLs are accepted.
- `hosts`: the public address of each worker. A hunt whose game server reports any other host is refused.

The deploy server looks at the file on every launch and re-reads it when it changes, so adding a worker is one
edit to this file. If the file is missing or unreadable the last good copy is used, then the
`US_DEPLOYSERVER_URL` / `US_PUBLIC_HOST` and `GERMANY_DEPLOYSERVER_URL` / `GERMANY_PUBLIC_HOST` settings, which
also accept comma separated lists.

The allowlist helper of a new worker still has to be added to the gateway's `ALLOWLIST_ADDITIONAL_URLS`, which is
read when the gateway starts.

## Linux workers

- `install-worker.sh --xvfb shared` runs one Xvfb service (`dauntless-xvfb.service`, display `:99`) for all game
  servers. With `--xvfb 1` every game starts its own `xvfb-run`, and games that start together can take down each
  other's display. Use `shared` for any worker that can start several games at once, and make the deploy
  service `Requires=` and `After=` it.
- Pass `--worker-user` the account that runs the deploy service. The launcher settings file is readable by that
  account's group only.
- `allowlist.mjs` loads its nftables rules from a file. Current Ubuntu refuses `nft -f -` when its input is a
  socket.
- `deploy-worker.sh --ref <branch|tag>` updates a worker from GitHub: it clones or fetches, builds the deploy
  server, swaps it in, and rolls back if the service does not answer. It leaves `/etc/dr-worker/*.env` alone.
