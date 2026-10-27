# Player origins: colleges, the International Pathway and the CFL

Date: 2026-10-27 · Branch: `claude/brave-heisenberg-fif49d` · Builds on 0.2.0 (practice squads, PR #89)

## Why

Every player gets a background: the school (or league, or country) he came from. Most come from US colleges, from
big programs and small schools. A few come through the NFL-style International Pathway or south from the Canadian
league. It makes prospects feel like people, and it gives the draft its oldest story: the small-school gem nobody
saw enough of, and the rugby convert nobody can read.

## Decisions (agreed in the brainstorm)

1. **Real school names, no mascots or logos.** "Texas", "Florida", "Texas A&M" are places and names. Nothing else
   (nicknames, marks, colors). The table is plain data, so a mod can replace it.
2. **What it does:** a talent mix by school tier from real draft data, and the fog of war (less film on small
   schools and international players). True ratings, development, contracts and play never read it.
3. **Entry routes:** a Pathway class each year with a reserved 17th practice-squad spot, and a few CFL veterans each
   offseason, on real rates where they exist. AFLS estimates are labeled.
4. **Existing saves:** a seeded migration from the same tables.
5. **No profiling:** origin is drawn from quality (and, for the Pathway, the program's position mix) only. It never
   reads a name or a heritage, and `identity.ts` is unchanged.
6. **Storage:** `Player.origin`, a number into a static table. A small, measured, named save allowance.

## Real-world anchors

| Fact | Figure | Source |
| --- | --- | --- |
| 2025 draft, four power conferences | 223 of 257 picks (87%) | [CBS](https://secure-www.cbssports.com/college-football/news/2025-nfl-draft-picks-by-college-team-school-sec-big-ten-dominate-as-ohio-state-flirts-with-record/), [SI](https://www.si.com/fannation/college/cfb-hq/rankings/2025-nfl-draft-picks-rankings-college-football-teams-conferences) |
| 2025 draft, FCS | 8 picks (3%) | same |
| 2025 draft, Group of 5 | about 26 (10%); Mountain West and AAC 6 each | same |
| Division II/III picks | about 1 a year | AFLS estimate from recent drafts |
| Opening-day rosters by level | FBS 87.9%, FCS 8.2%, Division II 2.4% | [College Football Network](https://collegefootballnetwork.com/nfl-players-by-college-conference-level/) |
| Pathway class | 13–14 athletes a year | [NFL, class of 2025](https://www.nfl.com/news/nfl-announces-international-player-pathway-program-class-of-2025) |
| Pathway practice-squad spot | one reserved international spot (the 17th) for every club since 2024 | [49ers Webzone](https://www.49erswebzone.com/articles/171876-nfl-practice-include-international-players/), NFL release above |
| CFL players signing south | a handful each January–February window; no official count | [TSN tracker](https://www.tsn.ca/cfl/article/nfl-workout-tracker-the-latest-on-cfl-players-down-south) |

FCS and Division II are a larger share of rosters than of the draft: small schools come in mostly as undrafted free
agents. The tier odds below reproduce that.

## Data: `src/engine/data/origins.ts`

```ts
export type OriginKind = 'college' | 'pathway' | 'cfl';
export type OriginTier = 'power' | 'group5' | 'fcs' | 'small';
export interface Origin {
  name: string;          // "Texas A&M", "Germany", "CFL"
  kind: OriginKind;
  tier?: OriginTier;     // colleges only
  weight?: number;       // colleges: relative NFL output within the tier (players on rosters)
}
export const ORIGINS: readonly Origin[];
```

- **Colleges:** every power-conference school plus Notre Dame, all Group of 5 schools, and a sample of FCS schools
  and Division II/III and NAIA schools with NFL alumni (about 200 entries). Within a tier, the weights follow real
  NFL output, so Alabama is far more common than a small power school.
- **Pathway countries:** the program's recent nations (Germany, UK, Australia, Nigeria, Mexico, France, Austria,
  Italy, Brazil, Japan, Ghana, New Zealand, Canada…).
- **CFL:** one entry, `CFL`. No CFL club names.
- **Append-only:** an entry's index is its saved id. A test pins the first entries so a reorder fails.

## Generation: `src/engine/origin.ts`

Each draw runs on its own stream, `new Rng(`${seed}:origin:${playerId}`)`, so no existing roll moves and no
sim number changes from the draw itself.

**College tier by class rank** (1–260; 224 are drafted). For a draft class this is the generator's own order
(`generateDraftClass` makes prospects from best to worst quality, so the loop index is the rank), not the consensus,
which itself depends on origin (below). These are the
starting odds; tests tune them to the targets.

| Rank | power | group5 | fcs | small |
| --- | --- | --- | --- | --- |
| 1–32 | 0.97 | 0.03 | 0 | 0 |
| 33–100 | 0.90 | 0.08 | 0.02 | 0 |
| 101–224 | 0.80 | 0.13 | 0.05 | 0.02 |
| 225+ and undrafted | 0.55 | 0.20 | 0.17 | 0.08 |

Targets: a class's draftable 224 lands near 86 / 10 / 3.4 / 1. A roster that is about 70% drafted and 30%
undrafted lands near FBS 89%, FCS 7.5%, small 3%, inside the real roster split.

**Who gets which rule:**

- **Draft class** (`generateDraftClass`): by the loop index, before the consensus grade is drawn.
- **Starting league** (`createLeague`) and **generated free agents** (`offseason/ai.ts`, `personnel/squadMarket.ts`):
  the rank band from where his overall sits among his position's players (top fifth: the 1–32 row, and so on);
  generated depth free agents use the undrafted row.
- **Pathway class:** origin `pathway` plus a country.
- **CFL veterans:** origin `CFL`.

Position doesn't enter the college draw. Australian punters who went to a US college show their college, as they
would on a real roster card.

## Fog of war

Origin changes how well a team can see a player, never what he is.

1. **Film:** `knowledge()` scales a prospect's base film (`0.2 + 0.15 × grade`) by `FILM`: power 1.0, group5 0.85,
   fcs 0.7, small 0.55, pathway 0.4 (AFLS estimate). Scouting visits narrow the ranges as today.
2. **Consensus noise:** in `generateDraftClass`, `CONSENSUS_SD` (grade and ceiling) is multiplied by `1 / FILM^0.5`
   for the prospect's origin, so small-school and Pathway grades miss more both ways (AFLS estimate). The draw order
   stays the same (the noise is scaled after the draw), so the class's own rolls don't shift.
3. **CFL film:** a CFL veteran's pro film counts each CFL season as half an NFL season
   (`0.45 + 0.08 × (nflSeasons + cflSeasons / 2)`). His CFL seasons are a number on the player (`cflSeasons`) only
   while he has no NFL experience; it isn't needed after (see Storage).
4. AI front offices see all of this through `perceive`; screens through `viewOf`/`Ovr`. Nothing else reads origin.

## Entry routes

**Pathway class** (13 a year, the real class size)

- Made at the end of the draft (`finishDraft`), joining the free-agent pool with the undrafted prospects, as real
  Pathway players sign after their pro day.
- Age 22–26, no experience, no service. Raw: a low current rating (about undrafted level) and a wide ceiling.
  Position mix from the program: mostly DL, OL, TE, RB, EDGE, a punter or kicker some years.
- **The international spot (profile `afls-2026-v2`):** each club has one extra practice-squad place, for a Pathway
  player only. It doesn't count against the 16. A Pathway player may also take a standard place.
- AI clubs fill their spot with the Pathway player their own scouts rate highest (`perceive(...).potMid`) when he
  reads at least as well as the worst player on their squad; your staff do the same when auto-squad is on (AFLS).
- Existing careers stay on `afls-2026-v1`: Pathway players still arrive, with no reserved spot.

**CFL veterans** (6 a year, an AFLS estimate)

- Made at the start of the offseason (`resign` phase), joining the free-agent pool (the January–February window).
- Age 24–29, 1–4 CFL seasons, no NFL experience or service (squad-eligible). Mostly depth; about one in six starter
  quality (AFLS estimate). Signed through the existing free-agent logic.

The "supply" rule (new players only where the pool can't fill places) and castoffs keep the pool steady;
`npm run offseason` checks it.

## Screens (`docs/UI.md`)

- **`OriginTag`** (`ui/origin.tsx`): plain text for a college ("Texas A&M"); a pill for the others,
  `Pathway · Germany` and `CFL`, each with its own color class (`tag-pathway`, `tag-cfl`) in both themes.
- **Player card:** always shows his origin.
- **Draft board and scouting tables** (`FrontOffice.tsx`): a sortable School column (`SortTh`).
- **Not shown** on rosters, free agency or stats tables.
- Origin is public (like an injury): every team and screen sees the same origin. Only ratings are fogged.
- Screen-contract test: an origin is only ever rendered through `OriginTag`.

## Storage and migration

- `Player.origin?: number` (index into `ORIGINS`) and, for a CFL arrival until his first NFL season,
  `Player.cflSeasons?: number`.
- **`SAVE_VERSION` 53 → 54**, with a `migrate.ts` step: every player (retired too) without an origin gets one from the
  same stream and tables. The rank band comes from his draft round (round 1: 1–32; rounds 2–3: 33–100; 4–7:
  101–224) or, without a draft record, from where his overall sits at his position. Deterministic per seed. Names
  and heritage aren't read.
- Practice-squad profile: new careers `afls-2026-v2`; existing ones keep `afls-2026-v1`.
- **Save budget:** an `origins` entry in `SAVE_FEATURE_ALLOWANCES` (`scripts/save-budget.ts`) with the measured cost
  and a little room, its comment giving the numbers. Expected about 60–80 KB first season, a few KB a season.

## Tests (written first)

- `ORIGINS` is append-only (pinned first entries); every college has a tier and a weight; no entry is a reserved
  name.
- Tier shares over many simulated classes match the targets (drafted and roster mixes) within tolerance.
- `origin.ts` draws the same origin for the same seed and id, and does not change any other stream (a fingerprint
  of a generated class matches main's ratings).
- Guard: generation with two different names for the same seed and id gives the same origin.
- Fog: knowledge at zero visits is ordered power > group5 > fcs > small > pathway; visits still narrow; own players
  stay exact. CFL film sits between Pathway and an NFL veteran with the same years.
- Pathway: 13 arrive after the draft; the 17th place takes only a Pathway player and only on v2; v1 unchanged.
- CFL: 6 arrive at the start of the offseason, squad-eligible.
- Migration: a v53 save gets an origin for every player, deterministically.
- UI: player card and draft board show `OriginTag`; pills for Pathway and CFL; no origin on the roster table.

## Checks

Typecheck and the touched tests locally. Draft boards move (they read `perceive`), so `npm run careers`,
`npm run trades` and `npm run offseason -- 6` at small sizes while tuning. CI runs the full plan. No range is loosened.

## Version and docs

- An after-alpha feature: **0.2.0 → 0.2.1** (`docs/VERSIONING.md`: anything that doesn't finish an MVP item), with an
  entry in `src/ui/changelog.ts`.
- `docs/MVP.md` "After alpha": a new line, **Player origins**, Already in (hooks into #9, scouting).
- `docs/PRACTICE_SQUADS.md`: the `afls-2026-v2` profile and its international place.

## Out of scope

College stats, conferences shown on screens, a regional scouting network (future work under "Deep scouting
network"), multi-step paths (college then CFL), hometowns and birthplaces.
