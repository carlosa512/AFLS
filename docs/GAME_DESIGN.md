# AFLS — game design & roadmap

## Vision

A deep, modern American football management sim: the management game Madden's franchise mode
never became. Like Football Manager, it is "a world, not a game": the league runs on its own and
stories emerge from interlocking systems rather than scripts.

**Pillars**

1. **Simulation you can trust.** Every snap is resolved from individual matchups. League-wide
   stats land inside real NFL ranges (`npm run sim`).
2. **Front-office depth.** The salary cap, the draft and player development are the game.
3. **Readable, calm UI.** One obvious next action, numbers that explain themselves, works on a
   phone.
4. **Open data.** Real NFL markets and divisions with original nicknames and fictional players;
   everything is JSON so the community can mod in real rosters.

## How the match engine works

Each play is a discrete event:

- **Pass:** offensive line pass-block vs. pass rush → pressure, sack, scramble or throwaway.
  Target chosen by depth and receiver quality; receiver route/speed vs. the covering defender's
  coverage/speed gives *separation*. QB accuracy for that depth + separation + hands + pressure
  → completion / interception. Yards after catch: receiver elusiveness vs. tackler.
- **Run:** run-block vs. run-stop (adjusted for the defensive call) plus rusher skill sets the
  line battle; break-away chances at the second and third levels.
- **Special teams, penalties, clock:** kickoffs (2025 touchback rules), punts with pinning,
  field goals by distance and kicker, false starts/holding/DPI, two-minute warning, timeouts,
  kneel-downs, 2025 overtime rules.
- **Coaching AI:** run/pass by down, distance, score and time; fourth-down aggressiveness;
  tempo; two-point chart.

Calibration (10 seasons): points 22.3, plays 64, YPA 7.2, completion 64.7%, YPC 4.15, sacks 2.5,
INT 0.77, 3rd-down 40%, FG 83.5%, home win 56%. Better-rated team wins ~69%.

## Roadmap

**✅ Foundation (done)** — 32 teams in the real NFL markets (original nicknames), 53-man rosters, 1–20 ratings, contracts
under a $301.2M cap, NFL-formula schedule, play-by-play engine, standings + tiebreakers,
14-team playoffs, box scores, league leaders, depth chart editing, autosave, placeholder
offseason (aging, retirements, generated rookies).

**Next: Front office core**
- Draft: procedurally generated college class (~350 prospects), scouting with confidence ranges
  that narrow with investment, combine measurables, boom/bust prospects, AI draft boards.
- Free agency and contract negotiation (asking price, years, guarantees), roster cuts to 53.
- Injuries (in-game and practice), injured reserve, depth that matters.
- Player development tied to age curves by position, playing time and coaching.

**Then: The cap**
- Signing bonus proration (max 5 years), dead money on cuts and trades, restructures,
  void years, cap projections for future seasons.
- Trades with AI valuation (players and picks).

**Then: Game day**
- Your game plan: run/pass balance, aggressiveness, coverage shell, blitz rate.
- Fatigue and rotations, weather, a live play-by-play viewer.

**Later**
- Coaching staff and scouting department, player morale and personality, media and owner goals.
- Modding: league import/export, an in-game editor, real-roster mods.
- Desktop packaging (Tauri) → itch.io prototype → Steam Early Access.

## Tech choices

- TypeScript + React, built with Vite. The engine is plain TypeScript with no browser
  dependencies, so it can move to a Web Worker, a desktop wrapper (Tauri) or a server unchanged.
- Saves are a single JSON document in IndexedDB. SQLite (via the desktop wrapper) becomes worth
  it once multi-decade careers make saves large.
