# Overclock Arena

A browser game for up to four players. Every hit speeds the ball up. The ball takes the hitter's colour, and if it touches anyone else they lose a stock. Last player with stocks wins the set.

- **Client:** `dist/index.html` is one self-contained file. three.js, CSS and fonts are inlined, and it makes no external requests.
- **Server:** `dist/server.js` is a Bun WebSocket server. It handles matchmaking and runs every match authoritatively at 60 Hz, with bots for practice and empty seats. It has no npm dependencies at runtime.
- **Hosting:** anyone can run a server with one command. Servers install each tested build this repo publishes, automatically.

## Playing

Enter a name and pick **Find a match**, **Practice vs bots**, or **Play with friends**. Keyboard, mouse and standard controllers (Xbox layout) all work, menus included.

**Play with friends** opens a private room with a 4-letter code. Share the link (`…/?room=K7QF`) or the code; the host can let bots fill empty seats and starts the match. When a match ends everyone lands back in the room for a rematch. The version (`build N · commit`) shows in the bottom-left corner, and a server reports its version at `/health`.

| Action | Keyboard + mouse | Controller |
|---|---|---|
| Move | `W` `A` `S` `D` | Left stick |
| Jump, double jump, wall jump | `Space`; again in the air or against a wall | `A`; same |
| Air dash | `Shift` | `LB` |
| Swing (keep holding after a hit to charge) | `J` or left click | `X`, `RB` or `RT` |
| Bunt | `K` or right click | `B` or `LT` |
| Aim high / low | Hold `R` / `F` | Right stick up / down |
| Curve left / right | Hold `Q` / `E` | Right stick left / right |
| Mute, menu | `M`, `Esc` | `Back`, `Start` |
| Director camera (while spectating) | `C` | `Y` |
| Full screen | `Alt`+`Enter`, or the button in the corner | Pause menu → Full screen |

- **Speed** climbs with every hit, up to 1000 on the speedometer. The freeze before each shot grows with it, from 0.05 s to about 1 s.
- **Perfect hits:** a swing that starts within 0.05 s of the ball arriving adds 10% speed and cuts the freeze by a third.
- **Curve:** the sideways input when the ball fires bends it like a curveball, until its first bounce or about 70° of turn. Curve shots are aimed by hand (no aim assist), and the dotted aim line shows the bend.
- **Charge:** keep holding swing after you connect. The ball stays on your bat past the normal freeze and fires up to 40% faster, but everyone gets that time to read your aim.
- **Aiming during the freeze:** you can only aim within 45° either side of where you faced when you connected, and the aim turns at 180° a second. The aim line sweeps visibly instead of snapping.
- **Weapons** are picked on the title screen; your colour comes from your seat:
  - **Breaker hammer (Power):** hits 12% harder, slower to recover from a miss.
  - **Arc racket (Reach):** 20% bigger hit zone, hits 5% softer.
  - **Rail staff (Timing):** 75 ms perfect window, quick recovery.
  - **Slab paddle (Spin):** curves bend 40% tighter, charges twice as fast.
- **Arenas:** box, octagon, pentagon, circle, star, plus, bowtie and triangle. Bounces follow each wall's angle, and the star, plus and bowtie have inward corners that throw the ball off at odd angles. Queue and practice matches pick one at random; in a private room the host picks.
- **Camera:** one fixed arena camera while you play. Once you're out of the set you can switch to the director camera, which orbits and punches in on big hits.
- **Wavedash:** press jump and dash together to skid along the floor at dash speed. Landing refunds the dash, so it chains at about twice running speed. The bots use it too.
- **Movement:** you get one double jump and one air dash per jump, and up to three wall jumps before landing. Each wall jump gives back the double jump and dash. Pushing into a wall while falling slows you to a slide.

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
| `bun tools/room-check.ts [ws-url]` | Private rooms: create, join, start, rematch, host handover |
| `bun tools/charge-check.ts [ws-url]` | Weapon choice and charged shots in a practice match |
| `bun tools/move-check.ts` | Movement and ball-physics unit checks (jumps, wall jumps, dash, curve) |
| `bun tools/soak.ts <matches> <seconds> [ws-url]` | Load test with concurrent bot matches |
| `bun tools/ws-check.ts [ws-url]` | Connects and waits for the server's welcome |
| `bun tools/hold-match.ts [ws-url] [seconds]` | Keeps a practice match running (CI uses it to test that updates wait for matches) |

The client connects to `/ws` on whatever host served the page. To point it elsewhere, add `?server=ws://host:port/ws` to the URL. Opening `dist/index.html` straight from disk defaults to `ws://localhost:8787/ws`.

## Run your own server

Anyone can host the game on an Ubuntu 22.04 or 24.04 server. One command installs everything (nginx, Bun, the game and an updater), and the server then follows this repo's builds by itself:

```sh
curl -fsSL https://raw.githubusercontent.com/griefzz/stickgame/main/deploy/install.sh | sudo bash
```

Open `http://<your server's IP>/` and play. With a domain, pass it so nginx answers on that name, then add HTTPS. The client switches to `wss://` by itself.

```sh
curl -fsSL https://raw.githubusercontent.com/griefzz/stickgame/main/deploy/install.sh | sudo DOMAIN=game.example.com bash
sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d game.example.com
```

Installer options (environment variables):

| Option | Default | Meaning |
|---|---|---|
| `DOMAIN` | any | Host name nginx answers on. Leave it out to serve on the bare IP. |
| `REPO` | `griefzz/stickgame` | GitHub repo whose builds the server follows, e.g. your fork |
| `AUTO_UPDATE` | `1` | `0` installs the current build and then only updates when you ask |

Re-running the installer is safe. It refreshes the setup and keeps your settings.

Your server installs whatever the repo it follows publishes, so point `REPO` only at a repo you trust or control.

### How updates reach servers

1. **CI builds and tests every push.** `.github/workflows/ci.yml` type-checks, builds and runs the server tests. Then, on a clean Ubuntu machine, it runs the setup script and rehearses three updates:
   - a first install;
   - a page-only update, checking the server keeps running;
   - a server update, checking it waits for a live match to end.
2. **Pushes to `main` are published** as a GitHub Release named `build-<n>`. The release holds `index.html`, `server.js`, the setup files and checksums. The 10 newest builds are kept.
3. **CI then installs the published build** with the one-line command above on another clean machine, to prove the public install path works.
4. **Every server checks for a new release every 2 minutes** (`overclock-update.timer`). It downloads and verifies the files, then switches over instantly:
   - **Page-only changes:** no restart, so matches keep running.
   - **Server changes:** restart the game server, but first wait for live matches to end, for up to 30 minutes.
   - **Failed health check:** the server rolls back to the previous build.

   Players idling on the title screen reload into the new version by themselves.

CI needs no secrets and no access to any server, so it works the same for forks.

### Running from a fork

1. Fork the repo and enable Actions on the fork (GitHub turns them off for forks).
2. Push to the fork's `main`. Its CI publishes `build-<n>` releases on the fork.
3. Install on your server with `REPO=<you>/<your-fork>`, or switch an existing server by editing `REPO` in `/etc/overclock/update.conf`.

### Day to day

| Task | Command |
|---|---|
| Update now | `sudo -u overclock-deploy overclock-update --now` |
| Install a specific build (roll back) | `sudo -u overclock-deploy overclock-update --tag build-41`, and set `AUTO_UPDATE=0` to stay on it |
| Pause automatic updates | Set `AUTO_UPDATE=0` in `/etc/overclock/update.conf` |
| Update log | `journalctl -u overclock-update` |
| Game log | `journalctl -u overclock -f` |
| Status | `curl http://127.0.0.1:8787/health` |

## Server settings

On a server, edit `/etc/overclock/overclock.env`, then run `sudo systemctl restart overclock`. Updates never overwrite this file. When running locally, set them as environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `MATCH_SIZE` | `4` | Seats in a match, 2–4. A lobby launches as soon as this many players queue. |
| `MIN_PLAYERS` | `2` | Fewest humans the queue will start a match with |
| `FILL_WAIT` | `12` | Seconds to wait for a full lobby once `MIN_PLAYERS` are queued |
| `BOT_FILL_TO` | `MATCH_SIZE` | When the wait runs out, bots top the match up to this many seats, but only if every player in the lobby has **Fill empty seats with bots** on. `0` turns bots off for queue matches and hides the toggle. |
| `ARENAS` | all eight | Arenas queue and practice matches pick from at random, e.g. `box,octagon,star` |
| `MAX_CONNS` | `400` | Connection cap |
| `PORT` | `8787` | Listen port. On a server it's set in the service file, and nginx expects 8787. |
| `HOST` | `0.0.0.0` | Bind address. The service uses `127.0.0.1`, behind nginx. |
| `INDEX_HTML` | next to `server.js` | Page served at `/` and read for the build ID |

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
deploy/              install.sh, setup-vps.sh, update.sh (overclock-update), activate.sh, systemd units, nginx.conf
tools/               test and load scripts
assets/fonts/        Big Shoulders Display + Chakra Petch (SIL OFL), embedded at build time
```
