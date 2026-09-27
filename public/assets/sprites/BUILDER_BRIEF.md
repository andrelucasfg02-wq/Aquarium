# Sprite assets for the Aquarium Pet Game

Source: the sprite sheet the user uploaded (5 chibi fish rows x 8 frames + decor row).
These are pre-sliced, transparency-cleaned PNGs ready to embed in the game.

## Location
`~/workspace/aquarium-pet-game/sprites/` — see `manifest.json` for the full spec.

## Species (the "rare beginning fishes", all rarity: Rare Starter)
- pink: Sakura Goldfish
- blue: Azure Tang
- orange: Ember Clownfish
- yellow: Lemon Drop Goldfish
- black: Midnight Moor

## Frames per species (8 each, uniform canvas, fish anchored so no jitter)
- frame0: idle / front view (faces the viewer — use when the fish is tapped)
- frame1-5: swim cycle (all face RIGHT; mirror horizontally for leftward movement)
- frame5: eat (food pellets baked in at the mouth side)
- frame6: special — sleep (pink, black: "z z" baked in) or happy (blue, orange, yellow: heart baked in)
- frame7: rear view (show briefly when the fish reverses direction — the "turn" move)

## Moves / animation wiring (best practice: canvas drawImage sprite cycling + state machine)
- swimming: loop frames 1-5 while moving; flip with ctx.scale(-1,1) when moving left
- direction change: flash frame7 briefly as a turn
- tap fish: frame0 (it faces you)
- feeding: fish swims to pellet, plays frame5
- happy (after feed/play): frame6 for happy species
- night / long idle: frame6 for sleep species

## Decor & FX (transparent PNGs)
- decor/: plant, coral, cave, log — placeable tank decorations
- fx/: heart, sparkle, splash, bubble1-3 — particle effects
