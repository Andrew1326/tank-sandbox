# Tank sandbox

Grey-box driving range for tuning tank handling in the browser.

    npm install
    npm run dev      # http://localhost:9400
    npm run smoke    # headless: top speed, 0-95 %, stopping, turn rate per hull
    npx tsx scripts/ramps.ts   # headless: slopes, ledge drop, gun impulses

`src/sim` is the simulation (Rapier rigid bodies, own suspension and track model, fixed 60 Hz step) and has no rendering code, so it can run on a server. `src/render` draws it with Three.js. `src/main.ts` wires keys, meters and the tuning panel; slider values persist in the browser and can be copied out as JSON.

Add `?shot` to the URL when taking automated screenshots.
