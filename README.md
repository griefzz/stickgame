# Overclock Arena

A browser game for up to four players. Every hit speeds the ball up. The ball takes the hitter's colour, and if it touches anyone else they lose a stock. Last player with stocks wins the set.

- **Client:** `dist/index.html` is one self-contained file. three.js, CSS and fonts are inlined, and it makes no external requests.
- **Server:** `dist/server.js` is a Bun WebSocket server. It handles matchmaking and runs every match authoritatively at 60 Hz, with bots for practice and empty seats. It has no npm dependencies at runtime.
- **Deploys:** every push to `main` is built, tested, rehearsed on a clean Ubuntu machine, then shipped to the VPS by GitHub Actions.

## Playing

Enter a name and pick **Find a match** or **Practice vs bots**. Keyboard, mouse and standard controllers (Xbox layout) all work, menus included.

| Action | Keyboard + mouse | Controller |
|---|---|---|
| Move | `W` `A` `S` `D` | Left stick |
| Jump / double jump | `Space`, again in the air | `A` or `LB`, again in the air |
| Swing | `J` or left click | `X`, `RB` or `RT` |
| Bunt | `K` or right click | `B` or `LT` |
| Aim high / low | Hold `E` / `Q` | Right stick up / down |
| Camera, mute, menu | `C`, `M`, `Esc` | `Y`, `Back`, `Start` |

## Develop

```sh
bun install
bun run dev          # builds, then serves http://localhost:8787
```

Open <http://localhost:8787> in two browser windows to play against yourself.

| Command | What it does |
|---|---|
| `bun run build` | Writes `dist/index.html` and `dist/server.js` |
| `bun run start` | Runs `dist/server.js` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun tools/smoke.ts [ws-url]` | Headless run of the queue and a full practice set |
| `bun tools/lagtest.ts <oneWayMs> [ws-url]` | Hit registration under simulated latency |
| `bun tools/queue-bots.ts <matchSize> [ws-url]` | Matchmaking rules: bot fill and lobby size (server needs `FILL_WAIT=2`) |
| `bun tools/abuse.ts [ws-url]` | Queue/leave spam can't fill slots or leak matches |
| `bun tools/dj-check.ts` | Double jump unit check |
| `bun tools/soak.ts <matches> <seconds> [ws-url]` | Load test with concurrent bot matches |
| `bun tools/ws-check.ts [ws-url]` | Connects and waits for the server's welcome |

The client connects to `/ws` on whatever host served the page. To point it elsewhere, add `?server=ws://host:port/ws` to the URL. Opening `dist/index.html` straight from disk defaults to `ws://localhost:8787/ws`.

## Deploy

### The pipeline

`.github/workflows/deploy.yml` runs on every push and pull request:

1. **Build and test:** type-check, build, start the server, and run the server tests.
2. **VPS rehearsal:** on a fresh Ubuntu 24.04 runner, run `deploy/setup-vps.sh` and deploy the build with `deploy/activate.sh`. Then check the page, `/health` and the WebSocket through nginx, and check that a client-only update doesn't restart the server.
3. **Deploy** (pushes to `main` only): upload the build to `/opt/overclock/releases/<commit>/` over SSH and run `activate.sh` there.

`activate.sh` points `/opt/overclock/dist` at the new release, then:

- **Server code changed:** restarts the game server. Matches in progress end.
- **Only the page changed:** no restart. Live matches keep running.

Either way, players idling on the title screen reload into the new version within a few seconds. Nobody is pulled out of a match or the queue.

If the server fails its health check, the script switches back to the previous release and the workflow run fails. The five newest releases are kept.

Until the secrets below exist, the deploy job skips itself with a notice, and builds still run.

### One-time setup

You need an Ubuntu 22.04 or 24.04 VPS with SSH access and sudo. Optionally, point a domain at it.

**1. Create a deploy key** on your own machine. GitHub Actions uses it to log in as the `deploy` user.

```sh
ssh-keygen -t ed25519 -f overclock_deploy -N "" -C overclock-deploy
```

**2. Prepare the VPS.** This installs nginx and Bun, and creates the `overclock` (runs the game) and `deploy` (receives builds) users. The `deploy` user's only extra right is restarting the game service. The script also installs the systemd service and the nginx site. It is safe to re-run.

```sh
git clone https://github.com/griefzz/stickgame.git && cd stickgame
sudo DOMAIN=game.example.com \
     DEPLOY_PUBKEY="$(cat overclock_deploy.pub)" \
     bash deploy/setup-vps.sh
```

Paste the `.pub` file's contents if it isn't on the VPS. Leave `DOMAIN` out to serve on the bare IP.

**3. Add the secrets** from your machine. They live on the `production` environment, which only accepts deployments from `main`. That way, workflows running on any other branch can never read the VPS key.

```sh
gh secret set VPS_HOST --env production --repo griefzz/stickgame --body "your.vps.ip.or.hostname"
gh secret set VPS_SSH_KEY --env production --repo griefzz/stickgame < overclock_deploy
ssh-keyscan -H your.vps.ip.or.hostname | gh secret set VPS_KNOWN_HOSTS --env production --repo griefzz/stickgame
```

To set up the branch lock on a fresh copy of the repo:

```sh
gh api -X PUT repos/griefzz/stickgame/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/griefzz/stickgame/environments/production/deployment-branch-policies -f name=main -f type=branch
```

| Secret | Required | Meaning |
|---|---|---|
| `VPS_HOST` | yes | VPS IP or hostname |
| `VPS_SSH_KEY` | yes | Private half of the deploy key |
| `VPS_KNOWN_HOSTS` | recommended | `ssh-keyscan` output. It pins the VPS host key; without it the key is trusted on first sight in every run. |
| `VPS_USER` | no | Defaults to `deploy` |
| `VPS_PORT` | no | Defaults to `22` |

**4. Deploy:** push to `main`, or run **CI / Deploy** from the Actions tab. The first deploy starts the server.

**5. HTTPS:**

```sh
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d game.example.com
```

The client switches to `wss://` by itself.

### Day to day

- **Ship:** merge or push to `main`.
- **Roll back:** revert the commit and push. Or re-activate a kept release on the VPS with `sudo -u deploy bash /opt/overclock/releases/<commit>/activate.sh <commit>`.
- **Logs:** `journalctl -u overclock -f`.
- **Status:** `curl http://127.0.0.1:8787/health` on the VPS.

## Server settings

Edit `/etc/systemd/system/overclock.service` on the VPS (`deploy/overclock.service` in the repo), then run `sudo systemctl daemon-reload && sudo systemctl restart overclock`. When running locally, set them as environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `MATCH_SIZE` | `4` | Seats in a match, 2–4. A lobby launches as soon as this many players queue. |
| `MIN_PLAYERS` | `2` | Fewest humans the queue will start a match with |
| `FILL_WAIT` | `12` | Seconds to wait for a full lobby once `MIN_PLAYERS` are queued |
| `BOT_FILL_TO` | `MATCH_SIZE` | When the wait runs out, bots top the match up to this many seats, but only if every player in the lobby has **Fill empty seats with bots** on. `0` turns bots off for queue matches and hides the toggle. |
| `PORT` | `8787` | Listen port. `activate.sh` health-checks this port; set `GAME_PORT` for it if you change it. |
| `HOST` | `0.0.0.0` | Bind address. The service uses `127.0.0.1`, behind nginx. |
| `MAX_CONNS` | `400` | Connection cap |
| `INDEX_HTML` | next to `server.js` | Page served at `/` and read for the build ID. The service points it through the `dist` symlink. |

Examples:

- **Three humans, fill the fourth seat:** the defaults. Three people queue, the 12-second wait runs out, and one bot joins.
- **Three-player lobbies:** `MATCH_SIZE=3`.
- **Top up small games only:** `BOT_FILL_TO=3`. A 1v1 gets a bot as a third player; three humans play without one.
- **Humans only:** `BOT_FILL_TO=0`.

Players can switch the bot toggle on the title screen or while queued. It's remembered in their browser and on by default. Practice always uses three bots.

## How it works

- **Netcode.** The server simulates and owns everything. Each client predicts its own movement with the same shared code (`src/shared/player.ts`) and corrects to server snapshots. Other players are interpolated about 60 ms behind. The ball is extrapolated to the present, which is exact between hits because it flies in straight lines with perfect reflections.
- **Lag compensation.** A swing is stamped with the server time at which the player pressed it. The server checks the ball's recent path at that moment, up to 200 ms back. When the ball touches a player, the server waits up to 150 ms, scaled to the human players' pings, before confirming the K.O., so a late-arriving swing in that window still counts.
- **Auto-update.** `build.ts` stamps each page with a hash of its contents (`<meta name="build">`). The server reports the ID of the page it's currently serving, and clients on the title screen reload when it differs from their own.
- **Rules** live in `src/shared/constants.ts`: speed curve, freeze length, stocks, swing window, hitbox size and jump heights.
- **Housekeeping** constants are at the top of `src/server/match.ts`:
  - A player idle for 75 s is removed.
  - A set is capped at 10 minutes; most stocks wins.
  - A client that stops sending input keeps being simulated, so nobody hangs mid-air.
- **Load:** eight simultaneous bot matches used about 4% of one CPU core and about 80 MB of memory.

## Layout

```text
src/shared/          constants, player movement, ball physics, shot aiming, wire protocol
src/server/          main.ts (HTTP/WebSocket + matchmaking), match.ts (game sim), bot.ts
src/client/          main.ts, game.ts (prediction/interpolation/effects), net, input, menu, hud, audio
src/client/render/   scene (arena), character, ball (+trail, aim telegraph), fx, camera
deploy/              setup-vps.sh, activate.sh, overclock.service, nginx.conf
tools/               test and load scripts
assets/fonts/        Big Shoulders Display + Chakra Petch (SIL OFL), embedded at build time
```
