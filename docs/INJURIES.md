# Injuries, condition and the medical staff

How players get hurt, how long they're out, what it leaves behind, and what a front office can do
about it. Engine: `src/engine/injuries.ts` (the model, injured reserve, the weekly cycle) and
`src/engine/medical.ts` (medical staffs). `npm run sim` checks the rates against the NFL.

## What a player carries

| Field | What it is | Who sees it |
|---|---|---|
| `traits.injuryResistance` (1–20) | How often his body breaks. Hidden, like every trait | Words only: an injury-risk tier (Low / Medium / High) |
| `traits.naturalFitness` (1–20) | How much condition a game costs, how fast it comes back, how well he heals and how much a severe injury takes for good | Never shown; it shows in his condition |
| `condition` (0–100) | Match fitness carried between games | Your own players (roster *Fitness* column, player card) |
| `injury` | Type, severity, weeks remaining, the doctor's estimate, playing through it or not | Everyone (the league's injury report); screens show the estimate, the engine knows the truth |
| `injuries` | History: type, severity, when, weeks, any scar | Everyone |
| `ir` | On injured reserve, and weeks served | Everyone |

Both traits are drawn from each player's own seed **after** the older traits, so adding them changed
nobody's work ethic, durability or temperament, and a migrated save gets exactly what a new league
would roll. Resistance leans toward durability (a body that ages well tends to hold together), and
natural fitness leans a little toward work ethic.

## Who gets hurt

Every scrimmage snap carries a small risk for each player on the field, scaled by how exposed his
position is (backs, receivers and the back seven run and collide the most, a quarterback in his
pocket the least). The collisions the play-by-play records add their own: a ball carrier brought
down, a sack, a hit on the quarterback, a tackle, a return. Each risk is split into **contact** and
**soft tissue**, then multiplied by:

- **Resistance at his age.** It holds through the prime, then fades about 0.6 a year once his
  physical tools start to go. A durable body (the *Built to last* label) adds a little and fades half
  as fast: the ironman who stays on the field into his mid-30s.
- **Energy late in a game.** Energy starts at his condition, drains with every snap he plays and
  partly comes back on the sideline. Below 65 the risk climbs exponentially (about ×2.5 at 55).
- **History.** Each injury in the last two years adds 7%. A soft-tissue injury he came back from in
  the last six weeks is half again as likely to go (hamstrings above all).
- **Playing through it** on injections: ×2.5, and if it goes, the old injury comes back worse.
- **Sports science** (soft tissue only): up to 25% fewer strains behind an elite department.

Injuries draw from their own random stream per game, so a game where nobody gets hurt plays out
exactly as it would with no injury model. An injured player leaves before the next snap and the next
man on the depth chart steps in; a position that runs out borrows from its neighbours (a safety at
corner, the punter kicking).

Practice adds a weekly roll for every healthy player on a team still playing, mostly strains, higher
for a worn-down body.

## How long

Each injury type has a range of weeks (short end likelier), shaped by:

- **Rehab**: the department's physiotherapy on the spec's curve. Elite (18–20) ×0.82→0.75, good
  (14–17) ×0.92→0.83, adequate (10–13) ×0.99→0.93, and a flat ×1 at 9 or below: a poor department
  follows the standard clinical timeline, never a slower one.
- **Natural fitness**: about ±14%.
- **Age**: 1.5% longer for each year past 29.

Severity follows the layoff: minor (1–2 weeks), moderate (3–6), severe (longer, and every torn ACL,
Achilles or worse). The worst kinds (multi-ligament knee, spinal) are career-threatening, and so is a
torn ACL or Achilles at 32 or older. The head doctor's estimate brackets the truth unevenly, tight
for a great doctor, a month wide for a poor one; it counts down with the injury.

**Scars.** A severe injury with a scar (ACL, Achilles, broken leg, Lisfranc, labrum, pectoral) takes
physical points for good, and his ceiling drops with them. Natural fitness decides how much comes
back. The player card shows exact points for your own players and words for anyone else's.

**The offseason** heals 30 weeks: an ACL from midseason still costs him the start of the next one.

## Injured reserve

- Only an injured player can go on it. He is off the 53 and out at least **4 weeks**.
- Coming back uses one of **8 return designations** a season (NFL rule). Once they're gone, the rest
  of the reserve list stays there until the league year turns, when it clears.
- AI teams, and yours unless you untick *Staff handles injuries* on the roster screen:
  - put anyone expected out about 5 weeks or more on reserve, in season or at camp;
  - bring players back when they heal;
  - sign a minimum-deal replacement when a position runs short (cutting a spare player if the roster
    is full).
- In the playoffs AI teams let a starter play through a minor injury. Injections are always your
  call: the staff never takes that gamble for you.
- A player on reserve can't be traded, and neither can one the doctor expects to miss two weeks or
  more (he'd fail the physical).

## Careers

- **Retirement:** on top of age, a veteran of 33+ with a long file (three injuries of two weeks or
  more, or 16 weeks missed, in the last three years) retires with 35% more probability. Anyone 30+
  coming off a career-threatening injury retires with 25%, and 60% at 33+.
- **Development:** fewer games played means fewer reps for a young player, through the existing
  `playedShare` hook.

## Quirks

Habits and bodies meet in `injuries.ts`:

| Link | What it does |
|---|---|
| **High-Knee Stride** (RB) | Brought down with the ball: injury chance ×1.25. His contact injuries land up top (head, neck, shoulder, ribs, chest ×1.6) and spare the legs (×0.6). |
| **Contact Averse** (RB) | Brought down with the ball: injury chance ×0.7. |
| **Gassed in High-Tempo** (DL) | Each snap costs 15% more energy, so the late-game risk climbs sooner. |
| **A serious hit** | A game injury from contact, moderate or worse (or any concussion), drops one marble in his bag: *Sees Ghosts* (QB), *Contact Averse* (RB), *Hears Footsteps* (WR, TE). It shifts the odds; the draws decide. |
| **Out injured** | No weekly habit draw: habits form and fade on the field. |

A new habit with an injury side plugs into the same places: `riskFactors` (who gets hurt),
`partLean` (where), `snapCost` (how fast he tires), `HIT_SHY` (what a hit leaves behind).

## Scouting the risk

An injury-risk tier is a read, not the truth:

- **Your own players** are read by your medical staff: sharp, not perfect, better with a better doctor.
- **Anyone else** is read by your scouts, with a wider error than other makeup (another club's medical
  file stays closed). A typical department misses a veteran's resistance by about two points, a poor
  one by up to five (an injury-prone bust who scouts as an ironman), an elite one by about one.
- **Everyone's injury reports are public.** More injuries than his snaps would predict over three
  years pull the read toward fragile; fewer pull it toward sturdy. A long file outweighs any scout.

## The medical staff

Every team has a head team doctor, two physiotherapists and a sports scientist. Each has
Physiotherapy and Sports science ratings (1–20, public like coaches').

- **Department ratings** blend the staff by role: physios carry most of the rehab, the scientist most
  of the prevention, and the doctor both plus the diagnosis. An empty chair rates 6.
- **Money:** paid from a medical budget (1.9% of the cap times the owner's staff generosity, off the
  cap). Deals run 1–3 years.
- **Hiring:** in the re-sign window and free agency. AI teams aim at their own quality goal; your
  expiring staff re-sign automatically unless you let them go.
- **Each league year** staff age and drift: young ones improve, the old fade. Tenure, a winning
  program and a generous owner each help a little.

## Calibration (`npm run sim`)

Targets are per team over a 17-game regular season, time-loss injuries only (a week or more):

| Stat | Range | Basis |
|---|---|---|
| In-game injuries per team-game | 1.0–1.6 | NFL surveillance 2018–20: ~645 out-a-week injuries a season (~1.2/team-game); 1.53/game in the rest-days study |
| Practice share | 15–30% | ACL tears 2013–20: 31% in practice |
| Per team-season | 20–36 | The above, plus practice |
| Weeks missed per team | 55–130 | In-season injuries only (PFR's 95–254 games missed by team in 2024 includes preseason and camp IR) |
| Concussions per team | 2–5 | 182 (2024) and 219 (2023) league-wide incl. preseason and practice; 59% miss a game |
| Torn ACLs per team | 0.6–1.5 | ~47 a season (2013–20) incl. preseason and practice |
| Hamstrings per team | 3.5–7 | ~160–175 a season (2008–20) |

Availability lands near the NFL's: about half of Week 1 starting quarterbacks and a third of lead
backs and top receivers play all 17 games.

The match engine was tuned with every starter healthy. With injuries on, backups take about a tenth
of the snaps, as they do in the NFL. A few base rates moved to keep league totals and season leaders
on NFL numbers:

- completion odds +1.3 points short, +1.1 medium, +0.3 deep;
- run base 3.97 → 4.03;
- short-pass YAC +0.25;
- normal-tempo runoff 28–39 s → 28–38 s;
- the lead back's carry share 0.62 → 0.625;
- target share per point of a receiver's targeting 0.04 → 0.042 (healthy stars see more of the ball,
  as the NFL's do).

Season-leader record counts are noisy: any change reshuffles every game, and a count near its
allowance flips. Over 60 seasons the original engine and this one each flag one. `npm run sim -- 10`
passes clean; `npm run careers` flags receiving touchdowns (5 seasons past the record in 32, 4
allowed), where the original flagged passing and receiving yards. League talent holds as before
(lowest starter OVR 12.72, original 12.73).

### Sources

- Concussions 2024/2023: https://www.nfl.com/news/concussions-decrease-to-historic-low-in-2024-nfl-season
- Time-loss injuries 2018–20 (1,934 over 87,132 exposures): https://pmc.ncbi.nlm.nih.gov/articles/PMC9742207
- Injuries by rest days (1.26 / 1.53 / 1.34 per game): https://pubmed.ncbi.nlm.nih.gov/32412782/
- Lower-extremity injuries 2015–18 (hamstring, ankle, groin, high ankle, MCL): https://pubmed.ncbi.nlm.nih.gov/32485114/
- ACL tears 2013–20, 31% in practice: https://pmc.ncbi.nlm.nih.gov/articles/PMC8873553
- Hamstrings: 2.4±2.1 weeks, 33% recur: https://journals.sagepub.com/doi/10.1177/23259671241298622
- Concussion return (median 9 days, 59% miss a game): https://profiles.wustl.edu/en/publications/return-to-full-participation-following-concussion-in-the-national/
- Achilles return to play (66%, ~11 months, performance drops): https://doaj.org/article/e9699c7f8c5f4328a721cb533aa8f6de
- Team games missed 2024: https://rotowire.com/football/article/the-most-injured-nfl-teams-in-2024-90221
- IR rules (4 games, 8 return designations): https://www.foxsports.com/articles/nfl/from-ir-and-pup-to-practice-squads-what-do-nfl-roster-designations-mean

Most figures come from abstracts and summaries rather than full papers, so they are ranges to aim
at, not exact targets.

## Not yet

- **Practice schedule.** The weekly practice roll is the hook for padded and light days, rest days
  and Full / Limited / DNP. Load per week can feed it directly.
- **In-game rotation.** Energy drives risk, not substitutions. The lead back is spelled on the plays
  his backup is part of, but there is no fatigue-based rotation yet (match engine v2, layer 5).
  Energy doesn't affect execution either, so league totals stay where they are.
- **Training camp and preseason injuries**, and the PUP list.
- **AI valuations** of other teams' players don't yet weigh injury risk (only an injury that fails a
  trade physical).
- **Medical staff size:** a fixed four chairs, not a staff that grows with the budget.
