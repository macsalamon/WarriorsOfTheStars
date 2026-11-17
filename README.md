# Warriors of the Stars, digital edition

A free, non-commercial fan project: a digital version of the starfighter combat board game *Star Warriors* (West End Games, 1987), played in the browser against the computer or over the network, with 2D and 3D boards, sound, many scenarios (dogfights, ground attacks, convoys, asteroid runs, capital ship battles) and forces bought with points.

It is an unofficial fan work. It is not made by, approved by or associated with Lucasfilm, Disney or West End Games; *Star Wars* and the names of its ships belong to their owners. The original rulebook and its artwork are **not** part of this repository: the game explains itself in [`docs/RULES.md`](docs/RULES.md), written for this edition.

**Licence.** The code and the texts written for the project are under the MIT licence (`LICENSE`). The pictures, 3D models and sounds are *not*: they are the work of others, used with permission or under their own licences, and stay under those terms (non-commercial use for most of them). See [`CREDITS.md`](CREDITS.md) before reusing anything from `public/assets/`. The ship models and sounds come from **Fate of the Galaxy**, whose team kindly allowed their use in this project.

**Just want to play?** Download a ready-made package from the Releases page (Windows, Linux or macOS): unpack it and run `start.bat` / `start.sh`. Nothing needs installing.

## Play

```bash
npm install
npm run dev
```

Use a Chromium-based browser (Chrome, Edge): the game runs much better there than in Firefox, where the 3D view is jerky.

Open http://localhost:5173. How the game works is explained in [`docs/RULES.md`](docs/RULES.md).

Under **Scenario** choose a ready-made scenario (dogfights, ground attacks on a turret base, convoys) or **Buy forces with points**: both players buy ships, pilots and gunners within a points limit, see each other's force and deploy, or the host chooses both forces. Pick a side; you play against the computer or over the network (below).

The menu has these options:

- **R2, auxiliary power and damage control:** repairs during the game, free actions, lower body ratings. On by default in points games.
- **Missiles, torpedoes and bombs:** projectile weapons for the ships that carry them. On by default in points games and ground attacks.
- **Initiative:** standard (the sides choose ships in turn) or advanced (every pilot rolls and the owners pick when each ship moves; a ship that tails an enemy may move with it).
- **Map:** static (a ship that flies off the edge has escaped) or adjustable (the board follows the fleet). Each scenario has its own default.
- **Arcs:** standard or advanced (on by default). Advanced arcs give the big ships port and starboard quarters and shields that can be angled to the sides.
- **Asteroid field:** none, sparse, medium or dense, drifting or moved by dice events. The game makes and moves the field; the map is then static.
- **Skill reduction:** makes the start-up skill rolls less random.

The ground attack scenarios put an attacking force against a base of turret guns round a ground target. A human defender places the base by hand before the ships; the turrets fire automatically under the limits the owner sets while planning. The convoy scenarios give one side ships that have to escape off the map for points, and the computer runs its convoy ships for the edge.

## Interface

The left column (ship window and log) folds away with the button at the left end of the bar above the board; the right column (the list of ships) steps between full cards, narrow cards (codes and numbers) and icons only with the pair of buttons at the right end. Choosing the ship to move and the target of a shot happens in that list (the ships you can choose come first) or on the board. Hex numbers are shown only when "Hex numbers" is on. The choices are remembered by the browser.

## Network game (two players)

One computer runs the host, which holds the game and tells each player only what they may see (the other side's set-up and plans stay secret until revealed):

```bash
npm run host                      # builds the page, then hosts on port 8787
npm run serve -- --port 9000      # hosts without rebuilding, on another port
npm run serve -- --load saves/autosave.json    # carries on with a saved game
```

The console prints the addresses, for example `http://192.168.1.20:8787` for the other player. Everyone opens the host's address in a browser:

- the player at the host computer picks **Host a network game**, then the scenario and a side;
- the other player picks **Join a network game** (the address is filled in) and gets the other side.

A player who closes the window or loses the connection gets the same side back by joining again; the page also reconnects by itself. The host keeps the game in `saves/autosave.json` after every command (and a copy of each finished game). The host player's **Save** button downloads the whole game as a save file, which also opens in a game against the computer. Windows may ask once whether Node may accept connections on the private network: allow it. **To play over the internet:** install `cloudflared` once (Windows: `winget install Cloudflare.cloudflared`; Mac: `brew install cloudflared`) and start the host with `npm run host:internet`. It opens a free Cloudflare tunnel (no account, no router settings) and prints a link such as `https://some-words.trycloudflare.com/?join`; the host screen shows the same link with a Copy button while nobody has joined. Send it to the other player by mail or chat: it opens the page on their joining screen. The address is new every time the host starts and works for as long as it runs. The folders of saves and scenarios stay closed to anybody but the host computer.

## Saves and scenarios of your own

On the computer that runs the game (`npm run dev` or `npm run host`) the page keeps two folders in the project:

- `saves/`: the **Save** button writes a file here (the name has the scenario, the game-turn, the date and the time, so a later save never replaces an earlier one), the game against the computer keeps `autosave-solo.json`, and the host keeps `autosave.json` and a copy of every finished game. The menu lists what is in the folder with a **Load** button (or **Host**, to carry on with it as the host of a network game, without restarting the host program). Loading from any file on the disk still works.
- `scenarios/`: a `.json` file here is a scenario of its own, in the same format as the entries of `data/scenarios.json` (see `scenarios/example-duel.json`); it appears under **Your scenarios** on the page of the premade scenarios.

Only a page on the computer that runs the game can use these folders; players who join over the network cannot. Where the page cannot reach them (it is served from somewhere else), **Save** downloads the file and the menu has the file picker, as before.

## Layout

- `src/net/` the network game: messages (`protocol.ts`), what each player may see (`redact.ts`), the game host without sockets (`host.ts`, tested) and the page's connection (`client.ts`)
- `server/main.ts` the host program: serves the built page and runs the game over WebSockets
- `src/engine/` the rules, pure TypeScript with no UI code (runs in the browser or Node)
- `src/ai/` computer players: `tactical.ts` (the one you play against), `simple.ts` (the older rule-based one, kept as a yardstick) and `random.ts` (for testing)
- `src/ui/` the browser interface (SVG board, panels)
- `data/` ship data, tables and scenarios (`scenarios.json`, whose parts are described at the top of `src/engine/scenario.ts`)
- `tools/` the ship pictures (the folders of renders and converted models they work in are not in the repository): `fotg-to-glb.mjs <path to the Fate of the Galaxy data folder>` reads the mod's ship models (`.pof`) into `Models/converted/` (git-ignored), one file per ship of the game with the squadron colours of `paint.mjs`; `render3d.html` renders them (settings per ship in `ships.js`) and `assemble-sprites.cjs public/assets/ships` turns the renders into the game's pictures; `contact-sheet.cjs` puts all the renders on one sheet. Run the page with `npx vite --config tools/vite.config.ts` and open `/tools/render3d.html`
- `docs/` the rules reference (`RULES.md`) and how the playable packages are built (`RELEASING.md`)
- `scripts/sim.ts` headless simulation: `npx vite-node scripts/sim.ts 50 all tactical basic`

## Checks

```bash
npm test          # rules tests, worked examples and AI games
npm run typecheck
```
