# Poaching and weekly protection (practice squads, step 5)

Date: 2026-10-26 · Branch: `claude/confident-mccarthy-4ps246` · Builds on the trimmed rules in `docs/PRACTICE_SQUADS.md`

## Why

A practice squad is only interesting if you can lose it: other clubs sign your best squad players to their 53, and
you can do the same to theirs. Two automatic protections a week keep your best bets safe with no upkeep. Same
fun-first trim as steps 1–4: the NFL's shape, not its paperwork. The feature stays off for ordinary careers.

## Rules

**Poaching.** Any club can sign another club's unprotected practice squad player to its own 53 on a new NFL
contract: the minimum for his seasons of service, 1 or 2 years. He always accepts (it's a promotion). No squad-to-
squad moves. Regular season only (weeks 1–18).

- **When:** an offer waits and resolves at the weekly settle point (`settleWeek`, before the week's first kickoff),
  after waivers and after protections lock. Order at a settle: waivers → lock protections → AI poaching offers →
  resolve every offer.
- **Next opponent:** a club can't poach from the club it plays this week (either way).
- **Room:** the signing club needs an open place on its 53 and the cap room when it offers and again when it
  resolves; otherwise the offer lapses with a reason. No conditional cuts.
- **Two clubs, one player:** the longer deal wins, then waiver priority (`waiverOrder`).
- **Call-ups:** call-ups file after the settle, so none is active when poaching resolves; a planned call-up for a
  poached player is cancelled.
- **Cost (AFLS trim of the NFL's three game checks and three roster-count games):** the new contract guarantees
  three weeks of his base pay (`guaranteed = min(base, 3 × salary / 18)`); cut him early and the rest is dead
  money through the existing ledger. No roster-count obligation.

**Protection.** Each club protects up to two of its squad players a week.

- **Automatic:** the two highest scout-estimated ceilings (`perceive(league, ownTeam, p).potMid`, ties by player
  id). Never the hidden `potential`. Same rule for every club.
- **Pins:** "Always protect" on up to two of your squad players; pins take their places first, automatic picks fill
  the rest. Pins persist while the player stays on your squad.
- **Lock:** the list locks at each week's settle, before poaching. Pin changes after the lock apply next week. A
  protected player who leaves (promotion, release) leaves his slot empty until next week: no cycling.
- Shown on the squad desk: "Protected this week · auto" or "· pinned".

**Losing a player.** When one of your squad players is poached, your head coach sends one short mail: who went, to
which club, and that he's on their 53 now.

**AI poaching.** AI clubs poach where they already pick injury cover after each game (`coverPositions` in
`injuries.ts`): if another club's unprotected squad player reads at least a point better, by their own read, than
the free agent they would sign, they make a poaching offer instead and hold that place on the 53 until the week's
settle. At the settle, a club still short at a position makes the same call against its best healthy option and the
best free agent. At most one offer a club a week; cap room above the in-season reserve; never a cut to make room.
(Revised during the build: the injury cycle fills every hole before the settle, so a settle-only trigger never fired.)

**Frequency.** No public league-wide count was found. AFLS target, labeled as an estimate: rare but real, 0.5–3
poaches per club a season (16–96 league-wide). The audit checks it.

## Data

`PersonnelState.poaching` (optional, enabled careers only; save version 48, an empty upgrade step):

```ts
poaching?: {
  season: number;
  offers: PoachOffer[];            // pending; another club's offers stay private
  results: PoachResult[];          // last 96, public
  locked: { week: number; ids: Record<number, number[]> };  // this week's protections by club
  pins: Record<number, number[]>;  // per club, at most two, persistent
}
PoachOffer  = { playerId; teamId; years: 1 | 2 }
PoachResult = { playerId; fromTeamId; toTeamId: number | null; season; week; reason?: string }
```

## Code

- New `src/engine/personnel/poaching.ts`: `protectedIds`, `lockProtections`, `setPin`, `poachProblem`,
  `submitPoachOffer`, `cancelPoachOffer`, `submitAIPoachOffers`, `resolvePoaching`, `poachContract` (shares the
  minimum-contract builder with promotion, plus years and the three-week guarantee).
- `flow.ts`: `settleWeek` runs protections and poaching after waivers.
- `inbox.ts`: `squadPoachedMail` (key `squadPoach:season:week:playerId`), head coach's voice.
- UI: `PracticeSquad.tsx` gets the protection badge, the pin toggle on your rows, "Sign to our 53" on other clubs'
  rows (dialog: years, cost, cap after), your pending offers with cancel, and recent poaching results.
- `scripts/poaching.ts` (`npm run poaching -- 2`), registered in the check planner next to `elevations`.

## Testing

- Protection: auto picks the two best scout ceilings; pins override; a pin after the lock waits a week; a protected
  player who leaves frees nothing until next week; reload never re-picks.
- Poaching: protected players can't be signed; a planned call-up is cancelled; next-opponent block both ways; no room or cap →
  lapses with a reason; two offers → longer deal, then priority; the poached player is on the new 53 with a
  minimum contract and three guaranteed weeks; cut a week later → the rest of the three weeks is dead money;
  the old club's squad pay stops; mail arrives once.
- AI: offers only when short, by its own read, at most one a week; the audit's 16–96 band over a season on two
  worlds; rosters ≤ 53, cap legal, reload determinism.
- Ordinary careers: unchanged (the personnel fingerprint test).

## Shipping

Bump to 0.1.15 with a changelog entry for what players can see now (choosing your GM's name and starting age);
practice squads stay off. Update `docs/PRACTICE_SQUADS.md` and the `MVP.md` line. Open the PR once local checks
pass, then read CI and fix what's red.
