# AFLS

A deep American football management simulation: run a franchise in a fictional 32-team league,
set the depth chart, and watch every snap play out from real player-vs-player matchups.

## Play

```bash
npm install
npm run dev        # open the printed local URL
```

## Develop

```bash
npm test           # engine tests
npm run sim -- 10  # simulate 10 seasons and compare stats to NFL averages
npm run build      # production web build in dist/
```

See [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) for the vision, how the engine works, and the
roadmap.
