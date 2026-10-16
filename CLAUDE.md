# AFLS — working notes for Claude

AFLS is an American football management sim ("Football Manager for the NFL"). Vision, scope and
roadmap live in `docs/GAME_DESIGN.md`; the market research behind it is in `docs/research/`.

## Standing instructions from the project owner

- **Subagents: cheapest model that still does the job well.** Saving tokens matters, but not
  at the cost of speed or quality. Use `model: "haiku"` for simple, mechanical work (searches,
  data lists, boilerplate) and `model: "sonnet"` for anything needing judgment or real coding.
  Do the work inline when an agent isn't clearly needed.
- Keep explanations short and concrete, with a clear next step.

## Commands

- `npm run dev` — local dev server (Vite)
- `npm test` — engine tests (Vitest)
- `npm run typecheck`
- `npm run sim -- 10` — simulate 10 seasons and compare league stats to NFL averages.
  **Run this after any change to `src/engine/match/` and keep stats inside the target ranges.**
- `npm run endings` — audit thousands of game endings for nonsense (trailing team running out the
  clock, missed last-second kicks…). Run it after any coaching (`match/coach.ts`) change.
- `npm run audit` — raise each attribute in turn, replay the same games, and check it moves play;
  rewrites `docs/ATTRIBUTES.md`. **Run it after changing `attributes.ts`, `OVR_WEIGHTS` or how the
  engine reads ratings.** Nothing may be listed under "Needs attention".
- `npm run careers` — age a cohort of every position and play 8 seasons; checks peaks, declines,
  retirements and trait effects against the research ranges. Run it after changing `development.ts`,
  `aging.ts`, `traits.ts` or retirement. Nothing may be flagged ▲/▼.
- `npm run offseason -- 6` — run seasons back to back and summarize AI front-office activity, cap
  health, roster sizes and league talent. Run it after changes to `finance/`, `offseason/` or
  `trade.ts`; talent, cap space and rosters should stay stable across seasons.
- `npm run build` — web build to `dist/`
- `npm run build:single` — one self-contained page at `dist-single/afls.html` (for sharing/previews)

## Architecture

- `src/engine/` — pure TypeScript simulation. No DOM, no React, no `Math.random` (all
  randomness goes through the seeded `Rng`, so a league seed reproduces the same world and each
  game is reproducible from `${seed}:${season}:${gameId}`).
  - `attributes.ts` the attribute registry: labels, aging families, and the named **contests** the
    engine resolves (`skill(player, contest)`). The match engine never reads `player.ratings` directly.
  - `scouting.ts` what a team believes: knowledge, perceived ranges (seeded per team and player),
    stars, scout reports, scouting visits, combine generation
  - `staff.ts` scouting departments: who reads which player (`readFor`), accuracy, the staff budget,
    contracts, the market, ageing, AI hiring. All staff changes go through this module (it keeps a
    per-team index; `teamStaff()` returns a shared read-only list)
  - `generate.ts` league/player creation · `roster.ts` depth charts, team ratings
  - `development.ts` yearly growth and decline · `aging.ts` the one aging table (development,
    retirement, contract asks and trade values all read it) · `traits.ts` hidden traits and their hooks
  - `match/gameSim.ts` play-by-play engine · `match/coach.ts` AI decisions (pure functions)
  - `season/` schedule (NFL 17-game formula), standings + tiebreakers, playoffs
  - `league.ts` week/season orchestration
  - `finance/` contracts as year-by-year ledgers (`contract.ts`: proration, dead money,
    restructures), team cap sheets and moves (`cap.ts`), the rank-based market, rookie scale and
    tags (`market.ts`)
  - `offseason/` the calendar (`index.ts`), negotiation, AI front offices (`ai.ts`), the draft
  - `trade.ts` pick charts, AI trade valuation and guardrails · `migrate.ts` save upgrades
- `src/ui/` — React screens. State is one mutable `League` in `ui/store.ts`; call
  `store.mutate(fn)` to change it (triggers re-render + IndexedDB autosave).

## Conventions

- Ratings are 1–20 (FM-style). Salaries are in **thousands of dollars**.
- **True vs. perceived:** the match engine, development, contracts and agents use true ratings. AI
  front-office decisions about *other* teams' players (draft, free agency, trades) use that team's
  own read (`perceive`, `viewCache` for loops); keep it that way. The UI shows the user's view only,
  via `viewOf`/`Ovr`/`RangeValue` in `ui/scouting.tsx`. Never render `player.ratings`, `playerOvr` or
  `player.potential` in a screen: it leaks the truth past the fog of war. Hidden traits are never
  numbers anywhere: screens use `characterNotes`/`careerOutlook` (words), AI uses `characterRead`.
- No attribute without an engine hook: anything in `OVR_WEIGHTS` must feed a contest at that
  position (unit-tested) and move outcomes in `npm run audit`.
- `yardLine` is always yards from the *offense's own* goal line (0–100).
- `League` must stay plain JSON. If you change its shape, bump `SAVE_VERSION` in `generate.ts` and
  add an upgrade step to `migrate.ts` (old saves are migrated on load, never thrown away).
- `league.season` is the league year: it ticks over when the offseason begins (like the NFL's March
  new year). Results screens use `resultsSeason()` to show the season just played.
- Cap math lives in `finance/contract.ts`; never store a single "salary" number on a contract.
- Teams use the real NFL markets and divisional alignment with **original nicknames**. Never
  ship NFL nicknames, logos, "Super Bowl" or "AFC/NFC" (see `RESERVED_NICKNAMES`). Real player
  names are a community mod concern.
- Match the existing style: small pure functions in the engine, comments that explain *why*.
