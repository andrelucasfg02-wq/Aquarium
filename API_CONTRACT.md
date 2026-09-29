# API contract — aquarium-public (backend ↔ frontend)

Base: same origin. JSON everywhere. Auth = HttpOnly cookie `aq_session`
(random 32-byte hex token, 30-day expiry, stored in `sessions` table).
All `/api/*` require auth except `POST /api/register` and `POST /api/login`.
Errors: `{ "ok": false, "error": "<message>" }`. Success: `{ "ok": true, ... }`.

## Auth
- `POST /api/register` `{name, email, password}` → 201 `{ok, user}`.
- `POST /api/login` `{email, password}` → `{ok, user}` (session cookie).
- Forgot password: `POST /api/password/forgot` `{email}` → always `{ok:true}`
  (never reveals whether the email is registered). Creates a 1-hour token and emails
  a reset link (`APP_URL/?reset=TOKEN`) via Resend (`RESEND_API_KEY`, `EMAIL_FROM`).
  Passwords are bcrypt-hashed — the old password can never be recovered, only replaced.
- `POST /api/password/reset` `{token, password}` → `{ok}` — validates the token
  (sha256-hashed at rest, single use, 1h expiry) and sets the new password.
- `POST /api/register` `{name, email, password}` → `{ok, user:{id,name,email}}`
  Validate: name non-empty, email format + unique (409 if taken), password ≥ 6 chars.
  Creates starter kit (see Starter kit). bcrypt hash (bcryptjs, 10 rounds).
- `POST /api/login` `{email, password}` → `{ok, user:{id,name,email}}` (401 bad creds)
- `POST /api/logout` → `{ok}` (clears cookie, deletes session row)
- `GET /api/me` → `{ok, user:{id,name,email,level,xp,coins,gems,food}}`

## State bootstrap (call on app load and after mutations that change time-based things)
- `GET /api/state` → `{ok, state:{ user, wallets:{coins,gems,food,xp,level},
  tanks:{owned:["small","medium","large"], active:"small"},
  fish:[Fish], eggs:[Egg], dirt:{spots:[{id,x,y}], green:bool, last_cleaned_at},
  decor_owned:[{deco_id,qty}], placements:[{id,deco_id,tank,x,y}],
  quests:[{id,title,desc,period,progress,target,claimed,reward_coins,reward_gems}],
  collection:[{species_id,seen,count}], settings:{music,sfx,quality} }}`

  Server MUST, inside this call, run the time-based maintenance in a transaction:
  1. Dirt: spawn 2 spots/hour since `last_cleaned_at` (random x,y in [0.08..0.92] x [0.3..0.9]
     artwork fractions), cap 15 total. `green = (now - last_cleaned_at) >= 5h`.
  2. Eggs: any `hatch_at <= now` → hatch: create Fish row (stage baby, born_at=now,
     lineage from egg) with `location='tank'` on the user's active tank if fish count
     on that tank < capacity else `location='inventory'`; delete egg row.
  Fish growth stage is DERIVED, never stored: from `born_at` + group schedule
  (see Growth). Client scales sprite 40% baby / 70% juvenile / 100% adult.

## Fish
Fish: `{id, species_id, group, variant, name, gender, location, tank, x, y,
  born_at, stage:"baby"|"juvenile"|"adult", fed_at, lineage:{mother,father,hybrid,generation}}`
`x,y` = fractions of tank artwork. New fish get random x,y in glass rect.
- `POST /api/shop/fish` → `{ok, items:[{species_id,name,group,rarity,price_coins,price_gems,desc}]}` (static catalog, §Catalog)
- `POST /api/shop/fish/buy` `{species_id}` → `{ok, fish}` — checks funds, tank capacity
  (12/22/35 by active tank tier), deducts, creates fish (random gender; female_betta always female),
  adds to collection.
- `POST /api/fish/sell` `{fish_id}` → `{ok, coins}` — sell price = 40% of buy price (min 10).
- `POST /api/fish/feed` → `{ok, pellets:n}` — needs food>0 (400: "no food"); n = max(fish in tank, 1);
  deducts 1 food; sets fed_at=now for tank fish. Client animates pellets + rush + munch (visual only).
- `POST /api/fish/tap` `{fish_id}` → `{ok}` — sets fed_at/happy_at (hearts emote), tiny XP (+1).
- `POST /api/fish/transfer` `{fish_id, tier}` → `{ok, tier}` — moves a fish to an owned tank
  with space; also places fish from inventory into a tank (`location` becomes 'tank').

## Tanks
- `POST /api/tanks/buy` `{tier:"medium"|"large"}` → `{ok}` — medium 5000 coins (any time),
  large 10000 coins (requires medium owned). 400 errors otherwise.
- `POST /api/tanks/switch` `{tier}` → `{ok}` — must be owned. Fish stay per-tank
  (fish.tank = tier where they live; switching tank shows that tank's fish).

## Breeding
- `GET /api/breeding/partners?fish_id=` → `{ok, partners:[Fish]}` — only fish in tanks,
  opposite gender, same group, not self. (Female Betta always female.)
- `POST /api/breeding/breed` `{male_id, female_id}` → `{ok, egg}` — validates:
  both exist, opposite genders, same compatibility group (goldfish/betta/shrimp/
  snail/bottom_fish), different fish. Cost: 2 gems (like original). Creates egg:
  `{id, group, variant_a, variant_b, hybrid:(variant_a!=variant_b), generation:max+1,
   hatch_at: now + group_hatch_hours, created_at}`. Incompatible → 400 "These species can't breed together".
- Egg: `{id, group, variant_a, variant_b, hybrid, generation, hatch_at, created_at}`

Hatch hours: goldfish 1, shrimp 2, betta 3, snail 4, bottom_fish 5, hybrid(any cross-variant) 24.
Growth days/stage: goldfish 1, betta 2, bottom_fish 3, hybrid 3, shrimp 1, snail 1.
(baby→juvenile = N days, juvenile→adult = N days, from born_at.)

Maple Betta crosses: the Maple Betta (`autumn_fish`, betta group) breeds with bettas.
A Maple Betta × betta egg hatches into a true hybrid (blended look), 50/50 between
the cross's two variants — not one parent's look:
- × Full Moon Betta → Rose Maple Betta / Ember Maple Betta
- × Crown-tail Betta → Dusk Maple Betta / Storm Maple Betta
- × Female Betta → Lilac Maple Betta / Petal Maple Betta
- × Plakat Betta → Tide Maple Betta / Coral Maple Betta
Hybrids are bred-only (never sold in the shop), `origin='bred'`, legendary rarity,
and tradeable on the fish market like any bred fish.

## Dirt / cleaning
- `POST /api/dirt/wipe` `{ids:[spotIds]}` → `{ok, remaining:n, green:bool}` —
  deletes those spots; if 0 remain and not green → last_cleaned_at=now.
- `POST /api/dirt/filter` → `{ok}` — requires green; deducts 100 coins (400 if broke);
  clears all spots, last_cleaned_at=now. Client plays bubble burst.

## Decorations
- `GET /api/shop/decor` → `{ok, items:[{id,name,file,price}]}` — 93 items from
  `public/assets/furniture/manifest.json`; price = tiered: index 0–30 → 120 coins,
  31–61 → 300, 62–92 → 600. (Server computes from manifest order.)
- `POST /api/shop/decor/buy` `{deco_id}` → `{ok, qty}` — deduct coins, qty+1.
- `POST /api/decor/place` `{deco_id, tank, x, y}` → `{ok, placement}` —
  needs owned qty>0, placements on tank < decor slots (10/20/30), x,y clamped
  server-side to glass rect (§Glass). qty-1.
- `POST /api/decor/move` `{id, x, y}` → `{ok}` — clamp to glass rect.
- `POST /api/decor/remove` `{id}` → `{ok}` — deletes placement, qty+1 (inventory).
- Placements: `{id, deco_id, tank, x, y}` with x,y as artwork fractions.

## Glass bounds (fractions of artwork, measured)
- small:  left .1076 right .8924 top .0951 bottom .8978
- medium: left .0880 right .9156 top .1230 bottom .8959
- large:  left .1378 right .8622 top .2387 bottom .8293
Clamp center: `cx ∈ [left+w/2, right−w/2]`, `cy ∈ [top+h/2, bottom−h/2]`
using item's rendered half-size (frontend knows PNG size; server clamps with
a 0.03 margin when size unknown).

## Quests / inventory / settings / minigame
- `GET /api/quests` → in state. `POST /api/quests/claim` `{quest_id}` → `{ok, coins, gems}`.
  Seed per user: 6 quests — 3 daily (feed fish 3× → 100 coins; wipe 5 dirt → 80 coins;
  play minigame → 50 coins) + 3 weekly (breed once → 5 gems; buy 1 decor → 200 coins;
  own 8 fish → 300 coins). Progress increments on the relevant actions; daily resets
  at UTC midnight, weekly Monday. Keep it simple: store period key.
- `POST /api/shop/food/buy` `{qty}` → `{ok, food}` — 10 coins each.
- `POST /api/settings` `{music,sfx,quality}` → `{ok}`.
- `POST /api/minigame/finish` `{score}` → `{ok, coins}` — awards min(score,100) coins,
  max 3 payouts/day (anti-abuse). Frontend implements a simple tap-the-fish game.

## Player marketplace (diamonds)
- Fish carry `origin` (`shop`|`bred`|`event`) and `event_id`. Tradeability (`fish.tradeable`,
  `fish.trade_lock` in state):
  - `shop` (commons bought in the Fish Shop): bound to the account, never tradeable.
  - `bred` (hatched from eggs): tradeable for diamonds.
  - `event` (event prizes) + offspring with `event_id`: locked as trophies while the
    event runs (`EVENT_META[event].ends_at`), tradeable after it ends.
- `GET /api/market/listings` → `{ok, listings:[{listing_id, price_diamonds, listed_at, seller_id, seller_name, fish}]}` (newest first, max 100).
- `POST /api/market/list` `{fish_id, price_diamonds}` → `{ok, listing_id}` — fish must be
  tradeable and not already listed; it leaves the tank/inventory (`location='market'`).
  Price 1–999999.
- `POST /api/market/cancel` `{listing_id}` → `{ok}` — seller only; fish returns to inventory.
- `POST /api/market/buy` `{listing_id}` → `{ok, fish_id, fee_diamonds}` — atomic: buyer
  pays diamonds, seller receives price minus 10% fee (burned), fish transfers to buyer's
  inventory. Can't buy your own listing; needs enough diamonds.
- Listed fish (`location='market'`) are excluded from tank, breeding partners, and are
  blocked from transfer/sell/breed until the listing is cancelled.

## Catalog (static, implement identically both sides)
Groups: goldfish: [sakura_goldfish, azure_tang, ember_clownfish, lemon_drop_goldfish, midnight_moor];
betta: [fullmoon_betta, crowntail_betta, veiltail_betta, female_betta, plakat_betta];
shrimp: [red_shrimp, blue_shrimp, yellow_shrimp]; snail: [snail]; bottom_fish: [bottom_fish].
Sprite paths: goldfish → `assets/sprites/<pink|blue|orange|yellow|black>/frame<N>.png`
  (map: sakura→pink, azure→blue, ember→orange, lemon→yellow, midnight→black);
  critters → `assets/new_critters/<id>_0<N>.png` (N=1..8 → frames 0..7).
Frame roles: 0 idle, 1–5 swim, 5 eat, 6 special, 7 rear.
Prices: goldfish 800 coins; shrimp 200; snail 250; bottom_fish 400;
  fullmoon/crowntail/female_betta 1000; veiltail/plakat 1400 coins or 8 gems.
Starter kit: 500 coins, 10 gems, 5 food, 2 fish (sakura_goldfish female + azure_tang male),
  small tank, 0 decor.

## DB (SQLite dialect via @libsql/client — local file, or remote Turso; WAL on local only)
users(id INTEGER PK, name TEXT, email TEXT UNIQUE, password_hash TEXT, created_at INTEGER);
sessions(token TEXT PK, user_id INTEGER, created_at INTEGER, expires_at INTEGER);
wallets(user_id INTEGER PK, coins INTEGER, gems INTEGER, food INTEGER, xp INTEGER, level INTEGER);
user_tanks(user_id INTEGER PK, small INTEGER, medium INTEGER, large INTEGER, active TEXT);
fish(id INTEGER PK, user_id INTEGER, species_id TEXT, grp TEXT, variant TEXT, gender TEXT,
  location TEXT, tank TEXT, x REAL, y REAL, born_at INTEGER, fed_at INTEGER, lineage TEXT);
eggs(id INTEGER PK, user_id INTEGER, grp TEXT, variant_a TEXT, variant_b TEXT, hybrid INTEGER,
  generation INTEGER, hatch_at INTEGER, created_at INTEGER);
decor_owned(user_id INTEGER, deco_id TEXT, qty INTEGER, PK(user_id,deco_id));
decor_placements(id INTEGER PK, user_id INTEGER, deco_id TEXT, tank TEXT, x REAL, y REAL);
dirt_spots(id INTEGER PK, user_id INTEGER, x REAL, y REAL, created_at INTEGER);
dirt_state(user_id INTEGER PK, last_cleaned_at INTEGER);
quests(user_id INTEGER, quest_id TEXT, period TEXT, progress INTEGER, claimed INTEGER,
  PK(user_id,quest_id,period));
collection(user_id INTEGER, species_id TEXT, count INTEGER, PK(user_id,species_id));
settings(user_id INTEGER PK, music INTEGER, sfx INTEGER, quality TEXT);
All timestamps = unix seconds (INTEGER). Every row has user_id; every query filters by it.
