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

Tuning sliders in online mode change the server's numbers for everyone connected.

Add `?shot` to the URL when taking automated screenshots.
