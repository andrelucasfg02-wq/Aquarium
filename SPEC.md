# Aquarium Public — portable rebuild SPEC

Standalone, self-hostable port of Andre's aquarium pet game (slug `aquarium-pet-game`).
Target: `~/workspace/aquarium-public/`, deployable with Docker to an Oracle Cloud
free VM (Ubuntu 24.04). Fresh database — no data migrates from the private version.

## Stack (no build step, keep it boring and portable)
- Node 20, Express, @libsql/client (local SQLite file, or remote Turso), bcryptjs. Vanilla JS + Canvas frontend.
- Layout: `server/` (app, db schema, routes), `public/` (index.html, css, js),
  `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `README.md`.
- Auth: register (name, email, password) / login / logout. bcrypt hashes, random
  session tokens in DB, stay-logged-in cookie. Every game row scoped by user_id.

## Art assets (COPY into public/assets/, never move the originals)
- `~/workspace/aquarium-pet-game/sprites/` — 5 rare starters (Sakura Goldfish,
  Azure Tang, Ember Clownfish, Lemon Drop Goldfish, Midnight Moor). Per-fish dirs,
  8 frames each: 0 front/idle, 1-5 swim cycle (face right, mirror for left),
  5 eat/munch, 6 sleep/happy, 7 rear/turn. See BUILDER_BRIEF.md there.
- `~/workspace/aquarium-pet-game/new_critters/` — 10 creatures: Red/Blue/Yellow
  Shrimp, Snail, Bottom Fish, Full Moon / Crown-tail / Veil Tail / Female / Plakat
  Bettas. Same 8-frame pattern. See BUILDER_BRIEF_2.md there.
- `~/workspace/aquarium-pet-game/tanks/` — tank_small.jpg (1125x1125),
  tank_medium.jpg (1125x634), tank_large.jpg (1125x750).
- `~/workspace/aquarium-pet-game/furniture/` — 93 decor PNGs, see manifest.json
  for ids/names/prices/tiers. Tiered coin prices, Buy/Place in Decoration Shop.

## Core rules (must match the original)
- Tanks: Small free, Medium 5,000 coins, Large 10,000 coins (Medium required first).
- Fish capacity: Small 12 / Medium 22 / Large 35. Decor slots: 10 / 20 / 30.
- Currencies: coins + gems. Player XP/levels. Food as inventory consumable.
- Bottom nav: Home → Fish Shop → Decor → Collection → Inventory → Quests.
  Plus Breeding screen and Settings (music/SFX toggle, graphics quality).
- Home screen: tank fills viewport edge-to-edge (100dvw x 100dvh), slim compact
  top HUD (coins, gems, level, player name, Edit), bottom nav fixed.
- Fish behavior: swim cycles while moving, turn frames on direction change, munch
  frames when eating, hearts when happy, Zzz when sleeping, face player when
  tapped. Female Betta always female. Snail and bottom fish move along the bottom.
- Genders (male/female), selling fish, quests (daily/weekly), minigames (basic but
  working), collection log with lineage.

## Feeding
- Feed button on main screen. Drops >= 1 pellet per fish; pellets sink slowly.
- Fish AI: nearest fish rush to nearest pellet; on catch play munch frame +
  happy eating emote. Uneaten pellets fade after ~15s. Consumes food inventory.

## Dirt / cleaning (server-side timestamps, progresses while app closed)
- 2 dirt spots spawn per hour at random tank positions (cap 15), persisted in DB.
- 5h without cleaning → green water tint overlay.
- Clean button → sponge mode: sponge follows pointer; dragging over spots wipes
  them with a pop. Wiping all spots resets the timer.
- Green water → "Filtrar (100 coins)" button: deducts 100, bubble-burst animation,
  water clear, dirt gone, timer reset.

## Breeding (compatibility groups — no cross-group breeding)
- Goldfish group (5 starters): any x any. Betta group (5): any x any.
- Shrimp (3 colors): any x any. Snail x snail only. Bottom fish x bottom fish only.
- Breeding screen lists only compatible partners; incompatible pick shows
  "These species can't breed together". Still requires male + female.
- Egg nursery under Breeding: each egg visible with live countdown. Hatch times:
  goldfish 1h, shrimp 2h, betta 3h, snail 4h, bottom fish 5h, hybrids (cross-variant) 24h.
- On hatch baby goes directly into tank (overflow → inventory). Growth stages
  baby → juvenile → adult by scaling sprites (40% / 70% / 100%), server-side:
  goldfish 1 day/stage, betta 2 days/stage, bottom fish 3 days/stage,
  hybrids 3 days/stage, shrimp 1 day/stage, snail 1 day/stage.
- Cross-variant babies randomly inherit one parent's look; lineage records both
  parents + hybrid flag + generation.

## Decorations / Edit mode
- Decoration Shop with all 93 items, tiered coin prices, Buy/Place.
- Edit button: drag decorations with touch/mouse anywhere inside the glass,
  remove-to-inventory, Done control, "Place in tank" from Inventory.
- Placement bounds per tank (artwork pixels), measured glass rectangles:
  Small 1125x1125: left 121, right 1004, top 107; Medium 1125x634: left 99,
  right 1030, top 78; Large 1125x750: left 155, right 970, top 179.
  Bottom bound = inner BOTTOM GLASS edge (whole sand placeable) — measure from
  the tank JPGs with the brightness-profile method (see EDIT_SPEC_glass_bounds.md
  in aquarium-pet-game/). Clamp using each item's rendered half-size.
- Positions persist in DB per user.

## Deploy
- Dockerfile (node:20-slim, sqlite file on a volume), docker-compose.yml,
  deploy.sh for Ubuntu 24.04 (installs docker, opens firewall port, runs compose).
  Serve on port 3000; document Caddy/reverse-proxy + optional domain step.
- Never commit secrets. README with local run + VM deploy instructions.

## Non-goals
- No real 3D (polished 2D sprite art, say so honestly in README).
- No public chat/multiplayer between users in v1.
