# Furniture pack integration brief — aquarium-pet-game

## Source files
`~/workspace/aquarium-pet-game/furniture/`
- 93 transparent PNGs, individually named (e.g. `sand_beige.png`, `shipwreck.png`, `beam_light.png`).
- `manifest.json` — `{ pack, count: 93, items: [ { id: "deco_<name>", file: "<name>.png", name: "Display Name" }, ... ] }`.
- Item ids are already unique (`deco_*`) and do not collide with existing decoration ids
  (`leafy_plant`, `pink_coral`, `stone_cave`, `mossy_log`, or the 4 originals).

The PNGs are clean cutouts of the user's uploaded furniture sheet: sand/gravel piles (7),
bricks & grass blocks (5), rocks (10), driftwood/logs/trees (9), plants (12), crystals (4),
corals & sponges (7), starfish/anemones (3), ruins/structures (11), shells/clams/pots (11),
volcano (1), bubblers (4), lily/lotus/duckweed (4), bubble ring, stone filter, glass tube,
waterfall filter, spotlight lamp, light beam.

## What to build
1. **Add all 93 as buyable decorations** in the Decoration Shop (new "Furniture" category/tab
   is fine, or merged into the existing Decor screen). Do NOT remove the 8 existing decorations.
2. **Pricing** (coins unless noted): small bits (shells, pebbles, starfish, sand dollar,
   duckweed, small plants, gravel piles) 30–120; medium (plants, rocks, corals, crystals,
   pots, logs, sand/brick/grass blocks) 120–350; large/feature (shipwreck, bridge, hut,
   waterwheel, castle gate, arches, volcano, waterfall, light beam, treasure chest) 400–1200.
   Keep the existing decorations' prices untouched.
3. **Decoration capacity** (user's explicit numbers — this is DECOR slots, not fish):
   Small/Starter tank: **10** · Medium tank: **20** · Large tank: **30**.
   Show a "Decor: n/10" counter; block placement beyond the cap with a clear message.
   Fish capacity (6/12/22) is UNCHANGED.
4. **EDIT MODE (the user's explicit request: "furniture I wanna place where I want, add an editing button")**
   - Add an **Edit** button (pencil icon) on the Home/aquarium screen.
   - Tapping it enters decorate mode: every placed decoration becomes **draggable**
     (touch/mouse drag) to **any position inside the tank**.
   - Tapping a placed decoration in edit mode selects it: show **Remove** (returns it to
     inventory) — no rotation/scale controls needed.
   - A **Done** button exits edit mode. Positions **persist in app.db** per decoration.
   - From Inventory: tapping an owned decoration offers **"Place in tank"** → opens the
     tank in edit mode with the item ready to drag into place; placing consumes one decor slot.
5. **Migration**: existing saves keep all fish, currencies, tanks, quests, breeding data,
   inventory, settings, and the 8 existing decorations. New decoration *types* must be
   seeded durably (server-side, not audit-sandbox-only) so they appear in existing games —
   the same durable pattern already used for the 4 previous decorations.
6. Bubblers/waterfall/filter/lamp/beam are decorative only (no new simulation needed).

## Do not
- Do not change fish capacities, tank prices, or the 3 tank background artworks.
- Do not remove or rename existing decorations/creatures.
- Do not claim 3D; this stays honest 2D sprite art.
