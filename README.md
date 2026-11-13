# Tank sandbox

Grey-box driving range for tuning tank handling in the browser.

    npm install
    npm run dev      # http://localhost:9400
    npm run smoke    # headless: top speed, 0-95 %, stopping, turn rate per hull
    npx tsx scripts/ramps.ts   # headless: slopes, ledge drop, gun impulses

`src/sim` is the simulation (Rapier rigid bodies, own suspension and track model, fixed 60 Hz step) and has no rendering code, so it can run on a server. `src/render` draws it with Three.js. `src/main.ts` wires keys, meters and the tuning panel; slider values persist in the browser and can be copied out as JSON.

## Online mode

    npm run server   # authoritative simulation on ws://localhost:9401
    npm run dev      # then open http://localhost:9400/?online
    npm run dev:lan  # same, reachable from other machines on the network

The server runs the same `src/sim` code at 60 Hz and sends a snapshot every second tick. Each client runs the simulation ahead of the server: keys apply immediately, and every snapshot rewinds the local world and replays the inputs the server has not processed yet. Corrections are drawn as a fading offset. The "Fake lag" slider delays traffic both ways to test the feel on a bad connection; `npx tsx scripts/nettest.ts 80` measures prediction error headlessly against a running server.

Tanks have health; a destroyed tank sits as a wreck, then returns to its spawn with a short shield. The server keeps the score. `npx tsx scripts/combat.ts` checks damage and respawn headlessly.

Maps live in `src/sim/level.ts`: `range` (the tuning ground, default offline) and `yard` (a walled arena, default on the server; `MAP=range npm run server` to change, `?map=yard` to drive it offline). `npx tsx scripts/yard.ts` checks its spawns and ramps; `npx tsx scripts/bots.ts 4 90 40` runs scripted players against the server.

Guns are `Slug` (single shot), `Lance` (charged beam) and `Pulse` (stream of bolts); pick hull and gun in the panel. On a map with bases the server runs capture the flag with two teams, Amber and Azure. `npx tsx scripts/guns.ts` and `npx tsx scripts/ctf.ts` check weapons and flag rules; `?showcase` lines up every hull and gun to look at the models (`src/render/models.ts`).

Tuning sliders in online mode change the server's numbers for everyone connected.

Add `?shot` to the URL when taking automated screenshots.
