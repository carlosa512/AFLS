# Compensatory picks — design

0.5's second piece (`docs/MVP.md`, "The offseason comes alive"). Agreed with the owner 2026-11-22.

## What it is for

Background realism with clear signposts. The league hands out picks for the free agents a team loses, the way the NFL
does in spirit, and the user always knows, at the moment he decides, whether letting a player walk or signing one moves
a pick. Aim for the NFL's average, not its formula.

## The rule

**A qualifying free agent** is a player whose contract ran out (he walked, `Departure.how === 'walked'`), who signs with
another team during free agency (`phase` free agency, before camp), for a first-year pay of at least `COMP.floor` of the
cap. A player who walks and comes back to his own team is no loss. Players cut or traded never qualify, nor re-signings, draft picks, waiver claims or undrafted rookies.

- **A loss** is a qualifying free agent who left your team. **A gain** is a qualifying free agent you signed from
  another team.
- **His round** comes from his new deal's yearly pay (average per year, as a share of that league year's cap), by bands
  in `COMP.bands`: the biggest deals bring a 3rd, then 4th, 5th, 6th and 7th. Below the floor he is not a qualifying
  free agent.
- **Cancelling**: gains are taken best first; each cancels the best remaining loss of the same round or lower; a gain
  bigger than every remaining loss cancels the best remaining loss. Losses left over are picks, best first, at most
  `COMP.max` (4) a team.
- **The tally is final** when free agency closes (camp). Its picks are awarded at the next new league year, for that
  league year's draft, and placed at the end of their round, ordered among themselves by the size of the deal that
  earned them (biggest first).
- **Awarded picks trade** like any other pick. A comp pick is never projected or tradeable before it is awarded.

**Tuning**: the floor and bands are set so a league hands out about 32 comp picks a year, spread across rounds about as
the NFL's are (2017–2025 average; numbers into `COMP` with their source in a comment). A tuning probe reads the
league's yearly total and its spread by round over several leagues; the step stops when the total sits within ±4 of the
NFL's and no round is off by more than half. No new judged check line is needed until the owner asks for one; the
offseason check prints the yearly total and per-round spread as a report line.

**Nothing new is drawn.** The tally is read from what happened (departures and signings), a pure function of the
league; awarding adds `DraftPick`s. AI front offices do not plan around comp picks (no change to who they let walk or
sign). That can be a later step.

## Data

- `DraftPick.comp?: true` — a compensatory pick. Its `originalTeamId` is the team that earned it.
- `DraftPick.compFor?: number` — the player whose departure earned it (for the letter, the list and SNN).
- No stored tally: losses and gains are read from `Player.left` and the free-agency signings in `league.transactions`
  (`kind: 'sign'` with `playerId`, this league year) through one reader, `compTally(league, teamId)`, which screens and
  the award share.
- Draft order: `setDraftOrder` places a round's comp picks after its 32 regular picks and numbers `overall`
  continuously (a round is no longer always 32 picks). Every reader that derives a round or a slot from `overall`
  assuming 32 a round is found and fixed (`pickLabel`, trade values, the draft room, SNN).
- Save upgrade: `SAVE_VERSION` bump, a no-op step in `migrate.ts` (old saves simply have no comp picks yet; a league
  year already past free agency gets none for it).

## What the user sees

Every line is one plain sentence, written to `docs/UI.md`'s "Words on a screen" and, in letters, `docs/NEWS.md`'s
"Words in a letter". No true ratings: an estimate comes from the player's market price as our staff read it, never
from the truth.

1. **Letting him walk** — the Re-sign tab's row and the re-sign window's contracts letter (`contractMail.ts`), for a
   player who would qualify: "If he signs elsewhere, likely a 4th-round compensatory pick next year." The round comes
   from his expected price (what his agent asks / the market's read), hedged as "likely". No line for a player who
   would not qualify.
2. **Signing one** — the offer dialog (`NegotiationDialog`) in free agency, when signing this player would cancel a
   loss: "Signing him cancels the 4th-round compensatory pick you are on track for (J. Smith)." No line otherwise.
3. **The running tally** — one line on the free-agency screen while free agency runs: "Compensatory picks on track: a
   4th (J. Smith), a 6th (R. Lee)." Hidden when there are none.
4. **The award** — at the new league year, a short letter from your director listing what you were awarded and for
   whom (one sentence a pick), or nothing if none. The picks show in your draft list marked "Comp".

**SNN's draft-day edition** (`snnDays.ts`): one line about your team's comp picks when you have any, and a line for
any other team's 3rd-round comp pick (the big ones). Nothing otherwise.

## Tests

- `compTally`: losses and gains from built scenes (walked and signed elsewhere, cut, traded, below the floor, signed
  after camp), the bands, cancelling (same round, lower round, a gain bigger than every loss), the cap of 4.
- Award: picks added once, at the new league year, at the end of their rounds, `overall` continuous, ordered by deal
  size; tradeable after, not before.
- Readers of `overall` work with rounds longer than 32 (pick labels, values, the draft room).
- Screens: each of the four lines appears only when it should (UI tests, screen contract), copy through `npm run copy`
  and letters through `letterRules.test.ts`.
- Tuning: a probe over several leagues for the yearly total and its spread by round; `npm run offseason -- 6` and
  `npm run trades` stay green (trade values read the new picks).

## Out of scope

AI teams letting players walk for the pick; the NFL's exact formula (snaps, awards, the 32-pick fill at the end of
round 7, the special 3rds for minority hires); comp picks for coaches or executives.
