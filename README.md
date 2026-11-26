# slackwater — browser / Devvit prototype

This is the browser port. No raea installation, native binary, CDN, external model download or backend is needed to play. The native prototype remains in ../compositions/.

## local

    npm ci
    npm run dev

Production preview:

    npm run build
    npm run preview

## controls

Click/tap go fishing. Aim on the water or use arrow keys. Click/space (or the bottom button) casts, then wait for the float to dip and press again to hook. Hold to reel, release to ease tension. Holding continuously breaks the line. Sound can be muted. Focus loss/hidden tabs pause simulation and audio. No scores are persisted or submitted.

## Reddit

The local Devvit CLI is pinned through package-lock.json. devvit.json uses a static post entrypoint, so no server permissions are requested. Its name is currently `slackwater-fish`; this name must belong to the signed-in Reddit developer before uploading. Use a registered name you own, or register the app at https://developers.reddit.com/new. Do not treat successful local checks as a Reddit approval.

    npm run reddit:playtest -- r/YOUR_TEST_SUBREDDIT

Playtest builds/watches the client and uploads it to Reddit. It requires developer authentication and a test community you can manage. Nothing has been published or installed by this implementation.

## validation

- npm run check: strict TypeScript plus 10 tests; same fishing outcomes at 30/60/90/120/144 Hz.
- Production build: 1,138,483 bytes total (about 1.14 MB), all local assets.
- Browser production page verified WebGL2, stylesheet and script load, no console errors/warnings. Scripted browser playthrough reached a successful catch.
- Config schema and built-file references validated with Devvit CLI Project.new(..., 'Static').
- Small viewport check: no horizontal overflow, 52px action button stays in bounds. Actual Android/iOS Reddit WebViews still require playtesting.
- Production dependency audit: no known vulnerabilities at install time. Devvit development tooling has upstream audit findings and is not shipped to players.

The Vite client bundles Three.js as a classic IIFE with external CSS and relative local asset URLs. There are no inline scripts, dynamic runtime imports, eval, remote dependencies or API calls in the game. Audio preloading is disabled and playback starts on interaction. The WebGL drawing buffer caps pixel ratio at 1.5. The fixed camera is letterboxed to preserve accurate pointer projection on phones. The pure fishing rules are imported directly from ../game/fishing.ts; the browser adapter does not duplicate gameplay.

Official references: https://developers.reddit.com/schema/config-file.v1.json and https://developers.reddit.com/docs/quickstart

## sunlight / water visual pass

26-degree camera and matching shared aiming projection; directional six-wave shader with filtered normals and sun glints; stronger key-light/shadow separation with warm camera-side fill; smooth welded rock normals with procedural mottling; quieter caustics; broken raft wakes. Browser snapshots inspected during two refinement passes. Final client remains about 1.14 MB. No reflection render target, downloaded textures or postprocessing dependency added. Native raea water/light parameters also updated; native GPU rendering remains unavailable in the agent sandbox.

## substantial visual refinement

Water now renders the actual reef into a bounded HDR colour/depth target, rejects above-water foreground samples, applies small refraction distortion and depth-dependent absorption, and uses restricted sharp sun glints. Reef detail is clustered and instanced, with shared caustic lighting across underwater materials, subtle terrain elevation, shells, starfish and contact shadows. Raft/fisherman materials, baskets, rope and rigged hands were refined; fish use species-specific painted bodies and schooling animation. Geometry/material batching reduced the initial integrated sample from 900 to roughly 412 draw calls including refraction and shadows.

Final build: 1,176,658 bytes (about 1.18 MB); 10 tests, strict TypeScript and Devvit static config checks pass. Browser casting/reeling/catch frames inspected. Production catch observed with no console errors. A 90-frame desktop rendering sample returned ~105 rAF fps and 3.81 ms average CPU submission time (not GPU time); mobile performance remains unmeasured. Detailed evidence: ../out/visual-refinement-validation.json.

Development-only deterministic inspection: `npm run dev`, then `/?inspect=100`, `/?inspect=380`, or `/?inspect=625`. This harness is excluded from production.

## living lagoon pass

A shared four-wave CPU/GLSL field drives raft corner buoyancy, bobber height/tilt and surface waves. The visual clock now runs before the first cast independently from fishing simulation time; hidden tabs still pause. Raft rolling/pitching and small casting/reeling/catch impulses move the complete rig and gear. Eight ambient species (24 fish) add distinct silhouettes, tail/fin motion, coherent schools, low reef routes and lure/disturbance responses without changing the three catchable species or game rules. Local disturbance normals dissipate and overlap; caustics remain underwater material lighting. Shared currents drive vegetation/fish, with restrained motes and bubbles.

Submerged objects already captured in refraction are skipped in the final surface pass. Production idle sample: 337 draw calls and ~113 rAF fps on desktop; catch sample: 426 calls. These are local samples, not mobile guarantees. 13 tests and strict TypeScript pass. Native single-frame raea staging passed. Build 1,184,609 bytes. Full live catch trace verified with no browser console errors. Evidence: ../out/living-lagoon-validation.json.

## reflection artifact root fix

The old white diamonds were created by multiplying two spatial sine trains, thresholding that product, and multiplying it into a thresholded half-vector highlight. That artificial lattice and the painted reflection lane were removed. Surface sunlight now uses a continuous anisotropic GGX microfacet BRDF with water Fresnel, Smith visibility, real light/view directions, pixel-filtered wind waves and smoothly modulated noncommensurate capillary normals. No opacity reduction or image blur is used to disguise the pattern. The HDR1280 refraction target remains separate from the procedural reflection; it was not the source of the diamond lattice.

Removed the sine-isoline contour shader, unused cell-grid caustic overlay, and geometric white ripple rings. Shared underwater focusing from a wave Hessian Jacobian now lights reef and fish materials in world coordinates; localized surface ripples perturb normals through soft warped Gaussian packets. The aim marker remains a targeting aid, not a water ripple.

Validation: strict TypeScript and13 tests pass; browser shader compilation has no errors. Inspected frames100/245/380/625 and refined GGX roughness after the first version showed excessive broad glare. Production bundle1,183,851 bytes. Raft, character and fishing rules preserved. Native caustic shader also no longer uses the old sine-product net; native GPU appearance is unverified in the sandbox.
