# AFLS — working notes for Claude

AFLS is an American football management sim ("Football Manager for the NFL"). Vision, scope and
roadmap live in `docs/GAME_DESIGN.md`; the market research behind it is in `docs/research/`.

## Standing instructions from the project owner

- **Subagents: use the Haiku model.** Whenever you spawn agents for this project, pass
  `model: "haiku"` to save tokens. Do the work inline when an agent isn't clearly needed.
- Keep explanations short and concrete, with a clear next step.

## Commands

- `npm run dev` — local dev server (Vite)
- `npm test` — engine tests (Vitest)
- `npm run typecheck`
- `npm run sim -- 10` — simulate 10 seasons and compare league stats to NFL averages.
  **Run this after any change to `src/engine/match/` and keep stats inside the target ranges.**
- `npm run build` — web build to `dist/`
- `npm run build:single` — one self-contained page at `dist-single/afls.html` (for sharing/previews)

## Architecture

- `src/engine/` — pure TypeScript simulation. No DOM, no React, no `Math.random` (all
  randomness goes through the seeded `Rng`, so a league seed reproduces the same world and each
  game is reproducible from `${seed}:${season}:${gameId}`).
  - `generate.ts` league/player creation · `roster.ts` depth charts, team ratings
  - `match/gameSim.ts` play-by-play engine · `match/coach.ts` AI decisions (pure functions)
  - `season/` schedule (NFL 17-game formula), standings + tiebreakers, playoffs
  - `league.ts` week/season orchestration and the placeholder offseason
- `src/ui/` — React screens. State is one mutable `League` in `ui/store.ts`; call
  `store.mutate(fn)` to change it (triggers re-render + IndexedDB autosave).

## Conventions

- Ratings are 1–20 (FM-style). Salaries are in **thousands of dollars**.
- `yardLine` is always yards from the *offense's own* goal line (0–100).
- `League` must stay plain JSON. If you change its shape, bump `SAVE_VERSION` in `generate.ts`.
- Fictional names only: no NFL team names, logos, "Super Bowl", "AFC/NFC". Real-name data is a
  community mod concern.
- Match the existing style: small pure functions in the engine, comments that explain *why*.
