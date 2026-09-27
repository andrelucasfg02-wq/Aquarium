# Aquarium Public — portable aquarium pet game

A standalone, self-hostable port of Andre's aquarium pet game. Polished **2D
sprite art** (no real 3D). Each player registers an account and gets their own
aquarium: fish, tanks, decorations, breeding, quests — all saved server-side.

## Stack

- Backend: Node 20, Express, @libsql/client, bcryptjs (`server/`)
  - Local runs use a SQLite file (`./data/aquarium.db`); on Render the same
    code talks to Turso (hosted SQLite) via `TURSO_DATABASE_URL` +
    `TURSO_AUTH_TOKEN`
- Frontend: vanilla JS + Canvas, no build step, no external CDNs (`public/`)
- Auth: register / login / logout, bcrypt password hashes, session-token cookie
- Every game row is scoped by `user_id`

## Run locally

```bash
npm install
npm start            # http://localhost:3000
```

The SQLite database is created automatically at `./data/aquarium.db`
(override with `DB_PATH`). Port via `PORT`.

To use a hosted Turso database locally, set the two env vars first:

```bash
export TURSO_DATABASE_URL='libsql://<your-db>-<your-org>.turso.io'
export TURSO_AUTH_TOKEN='<token from turso db tokens create>'
npm start
```

## Deploy free (Render + Turso)

Render's free tier has no persistent disk, so the game saves everything to
**Turso** (free hosted SQLite). No credit card needed on either service.

**Step 1 — Create the Turso database** (free, ~2 minutes)

1. Sign up at https://turso.tech and install their CLI
   (or use the Turso dashboard in your browser).
2. Create a database, e.g. named `aquarium`:
   ```
   turso db create aquarium
   ```
3. Copy the database URL:
   ```
   turso db show aquarium --url
   ```
   It looks like `libsql://aquarium-yourname.turso.io`
4. Create a token:
   ```
   turso db tokens create aquarium
   ```
   Keep this token secret — it's the password for your database.

**Step 2 — Put this code on GitHub**

1. Create a new repository on https://github.com (e.g. `aquarium-game`).
2. Upload this folder's files to it (drag-and-drop on the GitHub website
   works, or use GitHub Desktop).

**Step 3 — Create the Render service**

1. Sign up at https://render.com (free, no card).
2. Dashboard → **New** → **Blueprint** → connect your GitHub repo and pick it.
   Render reads `render.yaml` from the repo and creates the web service.
3. When Render asks for the secret environment variables, paste the two
   values from Step 1:
   - `TURSO_DATABASE_URL` → the `libsql://...` URL
   - `TURSO_AUTH_TOKEN` → the token
4. Click **Deploy**. After a minute or two the game is live at
   `https://aquarium-game.onrender.com` (your exact URL is shown in Render).

**Good to know**

- The free Render service sleeps after ~15 minutes with no visitors; the
  first visit after that takes ~30–50 seconds to wake up. Your fish and
  progress are safe in Turso while it sleeps.
- Never put the Turso token in the code or the repo — only in Render's
  environment variables page.
- The database tables are created automatically on first boot.

## Deploy to an Ubuntu 24.04 VM (e.g. Oracle Cloud free tier)

```bash
./deploy.sh
```

This installs Docker, opens port 3000, and starts the app with
`docker-compose.yml` (SQLite lives on a Docker volume, so data survives
restarts/updates). The game is then at `http://<VM-public-IP>:3000`.

> Oracle Cloud: also add an Ingress Rule for TCP port 3000 (0.0.0.0/0) in the
> subnet's Security List via the cloud console, or the port stays blocked.

Optional domain + HTTPS with Caddy:

```
yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

## Game features

- 3 tanks (Small free / Medium 5,000 / Large 10,000 coins), fish capacity 12/22/35
- 15 creatures: 5 goldfish starters, 5 bettas, 3 shrimp, snail, bottom fish
- 93 decoration items with drag-to-place Edit mode (glass-wall bounds per tank)
- Feeding (fish rush pellets + munch emotes), dirt/cleaning (sponge mode,
  green water, 100-coin filter), breeding with compatibility groups,
  egg nursery with live countdowns, baby→juvenile→adult growth
- Coins/gems economy, XP/levels, daily/weekly quests, collection log,
  tap-the-fish minigame, settings

Full API reference: [`API_CONTRACT.md`](API_CONTRACT.md).
Original build spec: [`SPEC.md`](SPEC.md).

## Notes

- Fresh database on first run — no data migrates from the private version.
- Never commit secrets; `data/` and `node_modules/` are gitignored.
- No multiplayer/chat between users in v1.
