# Builder brief — 10 new creatures + decor (2026-09-27)

Source: two sprite sheets the user uploaded (shrimp/snail/bottom-fish sheet + betta sheet).
All frames are sliced into clean transparent PNGs in this folder (`~/workspace/aquarium-pet-game/new_critters/`).
See `manifest.json` for the full file/ID/name mapping.

## 10 new creatures (8 frames each, same animation pattern as the 5 rare starter fish)

1. Red Shrimp (`red_shrimp_01..08`) — common
2. Blue Shrimp (`blue_shrimp_01..08`) — common
3. Yellow Shrimp (`yellow_shrimp_01..08`) — common
4. Snail (`snail_01..08`) — common. NOTE: snail should crawl along the tank bottom/glass, not free-swim like fish.
5. Bottom Fish (`bottom_fish_01..08`) — uncommon cory-like catfish; prefers the lower part of the tank.
6. Full Moon Betta (`fullmoon_betta_01..08`) — rare
7. Crown-tail Betta (`crowntail_betta_01..08`) — rare
8. Veil Tail Betta (`veiltail_betta_01..08`) — epic
9. Female Betta (`female_betta_01..08`) — rare. This one is explicitly FEMALE (use for breeding gender logic).
10. Plakat Betta (`plakat_betta_01..08`) — epic

Frame mapping (identical for every creature):
- `01, 02, 03, 05` = swim cycle, facing right (mirror horizontally when moving left)
- `04` = happy (heart + sparkles above the creature)
- `06` = eating (food pellets nearby)
- `07` = sleeping (Zzz above)
- `08` = front-facing idle/greeting (show when the creature is tapped)

## 4 new decorations (Decoration Shop)

- `decor_plant_1.png` — Leafy Plant
- `decor_coral.png` — Pink Coral
- `decor_cave.png` — Stone Cave (with starfish)
- `decor_log_plants.png` — Mossy Log with plants growing on it (single piece)

## 6 new fx (optional reuse)

`fx_bubbles_a.png`, `fx_bubbles_b.png`, `fx_hearts.png`, `fx_sparkles.png`, `fx_splash.png`, `fx_pellets.png`

## Integration checklist

- Add all 10 creatures to the Fish Shop catalog with rarity + prices (suggested: shrimp/snail 150–250 coins, bottom fish ~400, bettas 900–1600 coins with the epics possibly costing a few gems).
- Add Collection entries for all 10 (discovered/locked states, rarity labels).
- Genders: Female Betta is always female; assign random male/female to the others so they work with the male/female breeding system. Shrimp/snail/bottom fish can breed within their species too.
- Snail movement: bottom-crawler, not a free swimmer. Bottom fish: stays near the tank floor.
- The 5 original rare starter fish remain the free starting set — these 10 are shop purchases.
- Keep the chibi pastel aesthetic; everything persists in app.db like existing content.
