# Rocky Way

A 3D, real-time multiplayer railroad route-building game for the browser. It plays on desktop, tablets and phones. Players draft colored freight cards, build routes between cities on a low-poly diorama of North America, and race to complete contracts.

The board is original: 49 cities across Canada, the US and Mexico, 115 routes, and 51 contracts. They were generated from real geography by `scripts/gen-map.ts` and then frozen.

## Run it

```bash
npm install
npm run dev
```

- Open **http://localhost:5173**, enter a name and click **Create a new game**.
- The lobby shows a LAN link like `192.168.x.x:5173/?room=ABCD`. Phones and tablets on the same Wi-Fi can open it to join (2–5 players).
- To play several seats on one machine, use separate browser **tabs**. Each tab is its own player, and refreshing a tab reconnects it to its seat.

For a production-style single-port run:

```bash
npm run build && npm start      # serves dist/ + WebSocket on http://localhost:8787 (PORT env to change)
```

### Other scripts

| Script | What it does |
| --- | --- |
| `npm test` | Rules-engine tests, including 120 random full games checked for invariants |
| `npm run typecheck` | TypeScript check of client, server, shared code and scripts |
| `npm run geo` | Rebuilds `client/src/generated/geo.json` (coastline/lakes/borders) from Natural Earth |
| `npm run map:stats` | Prints stats and geometry checks for the route network (`-- --write` regenerates the frozen board — avoid unless redesigning it) |

`/devices.html` (dev only) previews the game in phone-sized frames.

## Layout

```
shared/     Pure, deterministic game logic used by both sides
  engine.ts   (state, action) -> new state; all rules live here
  view.ts     per-player GameView (hides other players' hands/contracts)
  protocol.ts WebSocket message types
  map/        cities, routes, contracts (the board)
server/     Node HTTP + WebSocket server; in-memory rooms, server-authoritative
client/     Vite + three.js app
  src/scene/  terrain (heightfield from real coastline), decor, board pieces, stage/camera
  src/main.ts UI state, HUD rendering, input
tests/      Vitest suite for the engine
```

The server owns the authoritative `GameState`. Clients send intents (`drawDeck`, `claimRoute`, …), the server validates them through the engine, then pushes each player their own `GameView`.

## Rules summary

On your turn, do **one** of these:

- Draw 2 cards from the market or the deck. A face-up engine (wild) counts as your whole draw.
- Build a route by paying cards of its color. Gray routes take any one color, and engines match anything.
- Draw 3 contracts and keep at least 1.

Routes score 1/2/4/7/10/15 points for lengths 1–6. Contracts add or subtract their value at the end, and the longest continuous line earns +10. The final round starts when someone has 2 or fewer cars left. In 2–3 player games only one track of each double route can be used.

## Known limitations

- Rooms live in server memory, so restarting the server (including the dev auto-restart) ends all games.
- If a player leaves mid-game, the game waits on their turn. There are no bots or turn timers yet.
- Accounts are guest-only. The session token is per browser tab (`sessionStorage`).

Map data © Natural Earth (public domain) via `world-atlas`.
