# Slackwater — browser / Devvit build

A quiet top-down fishing lagoon in Three.js. You row a little red boat, cast where the weed is thick, wait for the float to dip, then reel the fish home. Everything ships locally: no CDN, no backend and no runtime downloads.

## local

    npm ci
    npm run dev

Production preview:

    npm run build
    npm run preview

## controls

- Click or tap the water to row there; arrow keys also row.
- Double-click or double-tap, or press space, to cast toward the pointer.
- When the float dips, click or press space to hook the fish.
- Hold to reel and release to ease the tension. Hold too long and the line snaps.

The light drifts from noon to golden hour over about 2½ minutes. The Lantern Carp only bites in golden light.

## what's in the scene

- **Rowboat and fisherman** (`src/visual/boat.ts`): a parametric hull with a painted exterior, planked interior, gunwale rail, thwarts, floorboards, lantern, buoy, rope coil and basket. The fisherman wears a straw hat, a striped shirt and overalls. He rows with two oars, turns toward the line, bends the rod under load, and holds the catch up when he lands it. A white foam collar sits at the waterline.
- **Lagoon** (`src/visual/lagoon.ts`): a painterly floor made of domain-warped, posterised brush tones with caustics. It also has instanced rocks, lettuce clumps, seagrass, tube sponges, urchins, starfish, coral, and lily pads with lotus that bob on the swell.
- **Water** (`src/visual/water.ts`): a refraction pass of everything underwater, with depth-based teal absorption. The surface adds crisp thresholded sun glints, twinkling star sparkles, and thin white ripple rings for wakes, oar dips, the float, the otter and catches.
- **Creatures** (`src/visual/creatures.ts`): instanced koi and reef-fish schools with GPU tail-swim, an otter floating on its back near the boat, a spotted whale shark cruising underneath, and the hooked or landed fish.
- **Rules** (`src/game/fishing.ts`): pure and deterministic, with a fixed 60 Hz step. They cover rowing, casting, bites, reeling tension, the four species and the day clock.

## Reddit

`devvit.json` uses a static post entrypoint. Before uploading, the app name `slackwater-fish` must belong to the signed-in Reddit developer.

    npm run reddit:playtest -- r/YOUR_TEST_SUBREDDIT

## validation

`npm run check` runs strict TypeScript plus the node tests: rules, the fixed-clock runtime at 30–144 Hz, and the wave field. Shaders are precompiled with `compileAsync` before the start button enables.

Dev-only helpers: `?demo` plays itself, `?golden` starts in golden light, and `?play` skips the title. With the dev server running, `window.__tick(n)` steps the real loop `n` frames.
