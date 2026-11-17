# Retired players slimmed in place (the save stops growing)

Owner: carlosa512 · 2026-11-17 · follows 0.4.51 (`2026-11-17-long-league-speed-design.md`, speed)

## Intent

The save grows every season, and most of what it gains is retired players kept in full. The owner wants the save to
stop ballooning over a long career. Speed was the first half (0.4.51); this is the size half.

## What the recon found (2026-11-17, one league `archive-probe`, ten seasons)

- The save was 17.1 MB; its 2,989 retired players were 4.7 MB of it. By field, over all retired players: stats 812 KB,
  ratings 786, traits 473, personality 337, injuries 334, combine 289, quirkLog 191, quirks 123, statTeams 81, draft
  74, mentoredBy 51, left 39.
- Retirement already drops what only a developing player needs (`quirkBag`, `learning`, `dev`, `ratingHistory`,
  `mentor`…), at the new league year and for camp castoffs; every retirement goes through `retirePlayer` (0.4.51).
- A retired player opens the same full card as an active one, marked Retired: his ratings as your scouts read them,
  his makeup, habits, stats, injuries, combine.
- Readers outside the card: lists that show a perceived overall for every player in them (draft history), and your
  draft grades (`draftGrade.ts`), which read your scouts' view of a pick's ceiling and lock at the new league year
  (`lockVerdicts`, run in the same step as retirement, after it). `gmFindings` reads no ratings. The new league year
  also makes coaches of some retirees (`developCoaches`) and ends their ties after `retirePlayer` has run.

## The owner's answer: what a retired player's card shows

His career stats, his awards, the teams he played for, and his draft info. Nothing else.

## Goals

- **Size:** a retired player keeps only what that card and the game's history need. Expected saving about 2.5 MB of
  the 4.7 MB at ten seasons (about 15% of the save), and the save's growth a season falls by about that share.
- **Play unchanged:** every result the sim produces stays the same; only the dropped fields leave the save. Checked by
  hashing a played league with those fields removed, before and after (`scripts/fingerprint.ts` gains a `--slim`
  mode).
- **Old saves upgrade:** `SAVE_VERSION` 101, with a `migrate.ts` step that slims every retired player already saved.

## Non-goals

- Compressing the save file on disk (a separate follow-up worth doing on its own).
- Moving retired players out of `league.players` (option 2, rejected: every lookup by id would change).

## Anti-goals

- A screen, letter or check that breaks because a retired player has no ratings, traits or personality.
- A change in play: the draft grades and anything else the sim reads must give the same answers.

## Approaches

- **Slim them down in place (the owner picked this).** Retired players stay in `league.players` with the same ids;
  what the card and history don't need is removed at retirement and once for old saves. Least to change: records,
  awards, history and former players turned coaches keep working.
- A separate archive (`league.retiredPlayers`): the same saving, but every lookup by id in records, awards, history,
  transactions and letters must learn to check it. Rejected.
- Compressing the save on disk: no game change, but the save still grows each season. A follow-up, not instead.

## The design

1. **What a retired player keeps:** `id`, `firstName`, `lastName`, `nameEdited`, `position`, `age`, `heightIn`,
   `weightLb`, `jersey`, `experience`, `draft`, `stats`, `statTeams`, `splitStats`, `left`, `origin`, `portrait`,
   `gear`, `captainSeasons`, `retired`, `teamId` (null), `contract` (null). Everything else goes (`left` included, as
   today), in one function, `slimRetired(p)` in `roster.ts`.
2. **When:** after every step of the moment that still reads the retiree: at the end of the new league year's step
   (after `developCoaches`, the ties, `lockVerdicts`) and at the end of `retireCastoffs`. A reader that needs a number
   from a retired player's ratings later is found by the census and either reads a stored result (as the locked draft
   grades do) or gets a small stored field, added then; none is planned.
3. **The card:** a retired player's card is a career view: his name, position, Retired, the teams he played for by
   season, his draft line, his awards and his career stats. No ratings, makeup, habits, injuries, combine or scouting
   panel. Lists that show an overall for a retired player show none (a dash) rather than reading ratings.
4. **The save upgrade:** `SAVE_VERSION` 101; `migrate.ts` slims every retired player in a saved league (after the
   existing steps, so a draft grade is locked first where its step would lock it).

## Constraints

- `League` stays plain JSON; the new field and the dropped ones go through `SAVE_VERSION` and `migrate.ts`.
- The fog of war: the card showed your scouts' read of a retired player; the career view shows public facts only.
- Words on a screen follow `docs/UI.md`; `npm run copy` after the card changes.
- `retirePlayer` stays the one writer of retirement; `slimRetired` runs after the moment's own steps, as above.

## How we work

- First a census: every reader of the dropped fields that can see a retired player (the type checker helps once the
  slimmed shape is typed; a test slims every retired player of a played league and runs each reader over them).
- Play unchanged: the `--slim` fingerprint on two seeds, before and after, must match.
- Then the checks the change can move (`careers`, `offseason`, `gm-habits` read draft records), and the card and
  history screens shot with `npm run screens`.

## Left to the builder

How the slimmed shape is typed (a `RetiredPlayer` type or optional fields), the exact readers that move to `career`,
the career view's layout within the card's existing parts, and the `--slim` fingerprint mode.

## Calls made after the builder check (mine, for the owner to check)

- **No career summary field:** the draft grades read your scouts' view and lock before slimming; `gmFindings` reads no
  ratings. A field is added only if the census finds a reader that needs one.
- **`left` stays dropped**, as today; the card's teams by season come from `statTeams`.
- **Typing:** `Player` keeps its type; slimmed players lose the fields at runtime, and the census test (every reader run
  over a played league's slimmed retirees) is what guards them. Making `ratings`, `traits` and `personality` optional
  would ripple through hundreds of active-player reads.
- **Play unchanged** is checked with the `--slim` fingerprint: the dropped fields removed from both sides, then hashed.
