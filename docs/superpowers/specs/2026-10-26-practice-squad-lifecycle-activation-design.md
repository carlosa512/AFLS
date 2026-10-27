# Practice squads: the yearly cycle and switching them on (steps 6–7)

Date: 2026-10-26 · Branch: `claude/confident-mccarthy-4ps246` (from main after PR 83) · Rules: `docs/PRACTICE_SQUADS.md`

## Why

Steps 1–5 work, but only in test worlds: every squad dissolves each spring, AI clubs ignore their squads when
players get hurt, and a player who never opens the squad desk pays for a squad nobody uses. Steps 6–7 fix that and
switch practice squads on, closing MVP item #12 ("AI teams that manage their rosters sensibly"). Fog of war applies
everywhere: AI reads through `perceive`, screens through the user's scouts.

## Step 6: the yearly cycle

**Futures deals.** Once a club's season is over (eliminated, or the final played), it can keep **its own** squad
players for next season on a minimum one-year deal (his seasons of service, next league year's cap). At the new
league year (`beginOffseason`, where agreements now expire) each kept player gets that contract and joins the
offseason roster (90); everyone else becomes a free agent as today. At most 10 a club.

- AI clubs keep, by their own read, squad players whose estimated ceiling (`potMid`) reaches the overall of the last
  man at his position who'd make their 53, best first, up to 10.
- **Mail:** when your season ends, your director writes once: who the scouts would keep (names linked), and that
  staff will keep them unless you change it. A second short note at the new league year says who was kept.
- On the squad desk your rows get "Keep for next season" (on/off) in the futures window.

**AI clubs use their squads.** In injury cover (`coverPositions`, practice squads on):

- **Short absence** (every unavailable player at the position back within two weeks by the doctor's estimate) with a
  healthy squad player there who has call-ups left: no signing; the call-up at kickoff (`planAIElevations`) covers it.
- **Long absence:** promote the club's own best squad player at the position when its read of him is at least the
  best free agent's (`promoteSquadPlayer`); otherwise a free agent or a poach, as now.

**Your staff handles the squad (on by default).** `Team.autoSquad` (absent = on). With it on, the same AI rules run
for your club: refill open squad places, plan call-ups for short positions, choose futures. It never promotes,
signs to the 53 or cuts for you (that stays yours, as with injuries). A toggle on the squad desk turns it off.

**Kept as is:** injured squad players keep their place and pay; squad players already develop with their club's
coaches; playoff call-ups already work.

## Step 7: switching them on

**Mail, one each, easy reads, no follow-up clicks:** your waiver claim won or lost; your released player claimed or
cleared; a squad player's third regular-season call-up used (he needs a contract to play again). Plus the futures
notes above and the loss mail from step 5.

**Roster screen:** a view switch, "53 · Practice squad". The squad view works for any club through the team picker:
other clubs' squads show your scouts' read (`Ovr`, `ScoutedCeiling`), so a player your scouts haven't watched shows
wide ranges. It links to the squad desk.

**Who gets practice squads.** Every new career (`NewGame` passes `personnel: true`). An existing career gets a
one-time choice at its next offseason, before camp: the league office mails it, and the squad desk shows a "Turn on
practice squads" button until camp starts. Turning on is permanent for that career. Mid-season, nothing changes.

**Release.** The offseason audit (`npm run offseason`, both entry scripts) plays worlds with practice squads on.
#12 is Done when, over its seasons, no club starts a season below 50 on its 53 and none is under 53 with room for a
minimum deal: those two checks become strict (the "known issue" lines go), never loosened. Then `MVP.md` #12 → Done,
version 0.2.0 with a changelog entry, `docs/PRACTICE_SQUADS.md` and `docs/GAME_DESIGN.md` updated.

## Data

Save version 49 (an empty upgrade step: new fields are optional).

- `PersonnelState.futures?: { season: number; kept: Record<number, number[]> }` — per club, players marked to keep.
- `PersonnelState.offered?: true` — the one-time switch-on offer was made.
- `Team.autoSquad?: false`.

## Testing

- Futures: AI keeps only ceilings that reach its backup level, at most 10; your marks persist through a reload and
  become minimum contracts for next season at the new league year; the rest become free agents; mails arrive once.
- AI cover: a two-week injury with a squad player there signs nobody and the call-up files at kickoff; an IR
  absence promotes the own squad player when he reads at least the best free agent; otherwise unchanged.
- Staff: with `autoSquad` on your squad refills and call-ups are planned; off, nothing happens for you; never a
  promotion or a cut for you.
- Mail: each notice once, linked names.
- Roster view: squad view for your club and another, through your scouts' read (no true ratings in the markup).
- Activation: a new career has practice squads; an old save gets the offer only in the offseason before camp, and
  turning on mid-offseason forms squads at camp; a save that declines never changes.
- Audits: `offseason -- 6` with practice squads on, strict roster checks green; `waivers`, `squads`, `elevations`,
  `poaching` green; ordinary careers (`sim`, others) unchanged.
