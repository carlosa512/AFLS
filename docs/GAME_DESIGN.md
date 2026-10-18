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

Each play is a discrete event, resolved through named **contests**: pass protection vs. edge and
interior rush, run blocking vs. holding the point and run fits, short and deep routes vs. short and
deep coverage, breaking tackles vs. open-field tackling, and so on. Each contest is a weighted blend
of ratings defined in one registry (`src/engine/attributes.ts`), so every rating that counts toward
a player's overall has a real job on the field. `npm run audit` proves it: it raises one attribute at
a time, replays the same games and writes the measured effects to `docs/ATTRIBUTES.md`.

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
  tempo; two-point chart. Each team's play-caller shades run/pass and its head coach fourth downs
  (their style, see "How coaching works").
- **End-of-game scripts:** victory formation (kneel math knows the two-minute warning and whether
  the defense will really use its timeouts), a clock-killing fourth-down snap, two-minute drill
  (no runs in the last 40 seconds when trailing, scrambles to the sideline), spikes when out of
  timeouts, kick-now field goals, "play for the winning kick" (bleed the clock, last timeout, kick
  at the gun), onside kicks only when kicking deep can't work. `npm run endings` audits them.

Calibration (10 seasons): all 23 stats inside NFL ranges: points 21.6, plays 64, YPA 7.1,
completion 64.2%, YPC 4.1, sacks 2.4, INT 0.75, 3rd-down 40%, FG 86.3% on 1.9 attempts, home win
55%. Better-rated team wins ~68%.

## How scouting works: what you know vs. what is true

The engine always plays the true ratings. Every screen shows **what your front office believes**:

- **Your own players** are known exactly (their potential is still your coaches' best guess).
- **Everyone else** is a range that narrows with film: rookies are fuzzy, six-year veterans are
  well known. Athleticism shows on film more easily than technique; the mental game hides longest.
- **Draft prospects** are mostly guesswork. Each league year you get 30 **scouting visits**; each one
  removes about a third of the remaining uncertainty on one player. Your grade sits next to the
  league **consensus**, so a gap is either a sleeper or a bust you avoid.
- **Who reads him matters.** Every team has a scouting department: a Director of scouting, college
  scouts (prospects) and pro scouts (everyone in the league), each rated 1–20 on **Evaluation**
  (today) and **Projection** (ceiling), scouts with a position-group focus. A specialist reads his
  group best (+3), an off-focus scout poorly (−3), and the Director covers any group nobody
  specialises in (−1). That read scales both how wrong and how wide a range is (six points of read
  halve both), so ranges stay honest. Part of the error belongs to the reader, so a new scout brings
  his own opinions.
- Errors are seeded per team and player: a report never changes on refresh, and as knowledge grows
  the same error shrinks toward the truth. Nothing per team is stored except your scouting.

**Staff are a budget decision.** They're paid from a staff budget (about 3% of the cap), separate
from the salary cap, on 1–3 year deals. Hiring and dismissing happen in the re-sign window and free
agency; dismissing someone under contract costs half a year's salary. Expiring staff re-sign
automatically unless you let them go. Staff rise into their 30s and decline from their mid-50s;
part of the unhired market leaves football each year, so the league's average department stays put.

**AI teams act on their own reads.** Draft boards blend the consensus with each team's scouts,
trusting them as far as they're precise (so no team drafts worse than the consensus, but each
disagrees with it in its own places); teams look hardest at prospects near their own early picks.
Free agency, re-signings, cuts and trades use each team's read of other teams' players. In trades
that misread is half-trusted and capped (±0.35 overall), so shopping a player to 31 teams finds the
one that likes him most, but not a fantasy price.

On top of that: **0–4 stars** in half steps (vs. every player at the position, or vs. your starters)
with a shaded ceiling band, a plain-language **scout's report**, **combine** measurables generated
from true physicals plus noise (evidence, not truth), a **development chart** from yearly ratings
snapshots, tap-to-explain rating tooltips, and a side-by-side **compare** view.

## How players develop and age

Development runs once a year, at the start of the league year, on each player's own random stream
(so tuning it never reshuffles drafts or schedules). `npm run careers` checks the results against
the real-world ranges in the research doc.

- **Growth (under 26):** each year a player closes part of the gap to his hidden ceiling. Three things
  move the pace: his **work ethic**, which spans about ×0.4 to ×1.6, **reps**, and his **coaches**
  (see below). Reps are the share of last season's games he played. At 21 practice carries most of
  the growth; by 24 games do. A starter grows about 20% faster than average, and a player who never
  sees the field about 35% slower. Growth lands where it can still happen: physical tools are about
  done by 25, and late gains are technique and the mental game.
- **Aging:** one table per position (`aging.ts`) decides when each family of ratings starts to slip:
  - **Physical tools** go first.
  - **Technique** holds through the prime.
  - **The mental game** keeps sharpening for three more years.

  How it plays out by position:
  - **Backs** peak around 26 and fall hard from 28.
  - **Receivers, corners and the front seven** start fading at 29–30.
  - **Linemen and tight ends** hold into their early 30s.
  - **Quarterbacks** lose their legs from about 30, while their arm, accuracy and reads hold to
    about 35. A pocket passer therefore lasts and a runner doesn't, with no archetype field.
  - **Kickers and punters** last to the mid-30s, a few to 40.

  The same table also drives contract asks, contract lengths, trade values and the AI's re-sign,
  tag and contract-length age limits, so a 30-year-old back looks old to everyone and a 33-year-old
  quarterback doesn't.
- **Retirement** follows the same clock. Players under contract hang on while their body holds:
  retirement risk starts about two years past their position's prime and rises each year.
  Unsigned veterans and washed-up players walk away sooner.

**Hidden traits** (1–20 each, generated per player, never shown as numbers):

| Trait | What it does |
|---|---|
| Work ethic | How much of his ceiling he reaches, and how gently he declines |
| Durability (body clock) | Starts his decline up to two years early or late, sets how steep it is, and when he retires |
| Temperament | Linemen only: a hothead jumps early and grabs (false starts, offside, holding), a calm one rarely draws a flag |
| Injury resistance | How often his body breaks; it fades past his physical prime, slower for a durable body (`docs/INJURIES.md`) |
| Natural fitness | How much condition a game costs and how fast it comes back, how fast he heals, and how much a severe injury takes for good |

Other traits from the research (consistency, big-game play, adaptability, versatility) wait for the
systems they would drive, such as per-game form and schemes. "No engine hook, no trait" applies to
them too.

**Scouts describe makeup in words.** Once a team knows a player well enough (knowledge 0.5, so
about a year of film for a veteran, or a visit or two for a prospect), its scouts label what
stands out:
- Work ethic: Model pro, Driven, Coasts, Needs a push.
- Durability: Built to last, Wears down early.
- Temperament: Hothead, Even-keeled.

The projection scout judges makeup and body; the evaluator sees the flags. Reads carry the same
seeded, reader-owned error as ratings, are never exact for another club's player, and are marked
"early word" (dashed tags) while they're still loose. The player card adds a career outlook ("His
physical tools should start to fade after about 29; his technique should hold up through about
30"), timed to when his ratings actually drop. It also flags young players of yours who sit and
need reps.

AI front offices weigh the work ethic they read: a grinder they've sat down with gets more of his
ceiling on their draft board, re-sign and cut lists, and trade value.

## How coaching works

Every team has 11 coaching chairs: a **head coach**, an **offensive** and a **defensive coordinator**,
a **strength & conditioning (S&C) coach** and seven **position coaches** (quarterbacks, running backs,
receivers and tight ends, offensive line, defensive line, linebackers, secondary). Kickers and punters
train with the head coach and the S&C coach (the head coach alone keeps their technique).

Each coach has two public 1–20 ratings, and both feed player development (`src/engine/coaching.ts`):

| Rating | What it does |
|---|---|
| Youth development | Players under 26 close the gap to their ceiling faster |
| Veteran care | Players past their prime lose it more slowly. The S&C coach keeps bodies going (physical tools); everyone else keeps technique and the mental game |

Who counts for a player:
- **Growth:** his position coach 45%, his side's coordinator 20%, the head coach 20%, the S&C coach 15%.
- **Physical decline:** the S&C coach 40%, his position coach 35%, the head coach 25%.
- **Technique and mental decline:** his position coach 50%, his coordinator 25%, the head coach 25%.

A point of youth development across the whole staff is worth as much growth as a point of work
ethic (6.5%); one coach's point counts for his share (a position coach's point is about 2.9% for his
room, the head coach's 1.3%). A point of veteran care across the staff slows decline by 2.5–3%. The
combined effect is capped at ±30% growth and ±20% decline: past that, more rating buys nothing. An
empty chair counts as a weak coach (6). A typical staff (every rating 10.5) changes nothing, so
league-wide development is calibrated as before; the market and the AI's hiring goals keep the
average staff typical. `npm run careers` checks the size: the same draft class under a strong staff
(every coach 13) is about 0.2 OVR better at 26 and 0.5 better at 32 than under a weak one (every
coach 8), roughly 60% of what work ethic does; in a league, the same young players' years replayed
with a typical staff and with their own show about +0.1 OVR a year under the best staffs against
the worst.

Development runs once a year with the coaches a player finished the season with, so a hire takes
effect at the next league year's development. Free agents have no coaches: their year is neutral.
A new career starts with a full, typical staff: the first development pass comes before the first
re-sign window, so an empty chair there would cost a year you couldn't prevent. The first decisions
are the deals that run out after one season.

**Play-calling style** belongs to the coach and moves with him: the offensive coordinator leans to
the pass or the run (±6 points of pass rate), and the head coach is more or less aggressive on
fourth down (go-for-it odds ×0.6 to ×1.4 on the judgment calls); an empty chair calls a
league-average game. Style changes the mix, never the execution, and only in ordinary situations:
the last two minutes of the first half, the last five of the game, overtime and any clock-driven
tempo belong to the end-of-game scripts, the same for every coach. In a season a run-first offense passes about 54% of the time and a pass-first one about
59%; an aggressive head coach goes for it about 1.2 times a game and a conservative one 0.9.

**Hiring is like the scouting staff, with its own budget** (about 9.5% of the cap, $28.6M at the
opening cap, scaled by the owner: see "Owners" below). Asks scale with quality: a typical head
coach costs about $7.5M, a coordinator or S&C coach $2.6M, a position coach $1.1M. Deals run 1–3
years (head coaches up to 5); dismissing a coach costs half of what's left on his deal, at most a
year's salary. Moves happen in the re-sign window and free agency; a hire can replace the coach in
his chair in one move (his salary comes back, less severance, and the forecast counts it). Expiring
coaches re-sign automatically unless you let them go. A coach off a winning staff asks more (about a fifth
more after 13–4, a fifth less after 4–13): winners get raises and offers. Coaches keep
improving into their 50s and decline from their mid-50s; head coaches and coordinators retire from
their mid-60s, assistants a few years earlier.

**AI staffs** aim at a seeded quality goal per team (centred, so the league stays typical); win-now
front offices spend more on the head coach and coordinators, rebuilders on the teachers, and big-spending
owners aim higher. An AI team never
re-hires a coach it has just let go; head coach and coordinator moves around the league show in the
news. `npm run offseason` reports the coaching economy, the carousel and young players' growth under
the best and worst staffs.

**The coaching carousel** follows the NFL's (2015–2025: 7.0 new head coaches a year, range 5–10; about
12.5 new offensive and 11 new defensive coordinators; position coaches assumed 25–35%). When the
re-sign window closes:

- **The hot seat:** after a losing season an AI owner may fire his head coach (an 8–9 year sometimes,
  a 4–13 one usually; a first-year coach only after a disaster; 9–8 and up never). Each owner has his
  own streak, rolled per save: patient ones fire half as often, quick-trigger ones half again as often.
  Firing a coach with years left means paying two, so an owner who can't afford a real replacement keeps
  him. A head coach who survives a bad year often loses a coordinator for it instead.
- **Promotions:** a head coach or coordinator chair can go to a man one rung below, a coordinator for
  head coach and a position coach for his side's coordinator: from the team's own staff, the market or
  another team's staff, and as in the NFL (since 2020 for coordinator jobs) no team can block a
  promotion, the user's included. A winning staff gets raided most. The chair he leaves opens in turn,
  which is the carousel. Proven men in the chair (about a third of new head coaches are retreads) and
  insiders get a little preference; outsiders who never held a chair have more to prove.
- **A new head coach brings his own people:** he keeps a coordinator about one time in five (more if
  the man fits his vision) and half the teachers; whoever stays and is out of contract re-signs.
- **Vision:** every head coach wants something from his coordinators. A new one brings his own: an
  aggressive one a pass-first offense, a conservative one a run-first one, a former play-caller his own
  offense, and a defense of his own (a front and coverage, which reads as pressure or coverage). One who
  stays keeps his system: a coordinator he hires runs what the last one ran. AI teams hire coordinators
  who fit, so a new head coach changes how a team plays. Tastes come from the same mix coordinators do and
  defenses are matched by name, so fit decides who goes where without thinning out any kind of offense or
  defense. The Coaches screen shows each head coach's vision and how coordinators fit.
- **Teachers first:** hiring a head coach or coordinator, a GM keeps a typical teacher's pay aside for
  every open position-coach chair; the big names can't starve the rooms (promotions already skim the best
  teachers), and each role's new candidates are drawn toward a typical coach for that role.
- **You** can promote one of your own coaches into the open chair above his (Promote, in the window).
  Other teams can hire your assistants away for a promotion; the chair opens for you to fill.

**Former players** go into coaching: about one veteran in twenty who retires after four or more seasons,
more often a sharp, hard-working one, nearly always coaching the room he played in (a few cross to
another room on their side). His playing years count like a career coach's years on the sidelines, so he
starts level with a coach his age (better with a sharp football mind) and some work their way up. Their card switches between the coaching and playing careers, and the player
card links to the coach. Coaches who leave football keep their careers on file
(`league.retiredCoaches`) for records and a future hall of fame.

**Owners** spend what their markets earn: each owner's budgets (scouting, coaching, medical) follow
his market's real revenue (Forbes, 2024 season) on a square-root scale, centred on the average owner,
yours included: the biggest market spends about a third more, the leanest about a tenth less. The
coaching budget is the owner's comfort zone, not a league rule (the NFL caps players' pay, never
coaches'): he'll go past it, for a head coach or a coordinator only, when the team is going somewhere
(more after a playoff season), his market can carry it, or a new head coach is worth it after a losing
year, never two years running. AI teams weigh going over (it has to buy a clearly better man); for
you, a move past the budget asks the owner, who approves or blocks it and says why.

## How the front office works

Contracts are **year-by-year ledgers**, not a salary number: base salary and guarantees per league
year, signing bonuses prorated over at most five years, optional void years. Every cap
consequence falls out of a few formulas (see `src/engine/finance/contract.ts` and the research doc
`docs/research/`):

- **Cap:** cap hits, the offseason top-51 rule, carryover, 6–10% yearly growth with rare revenue
  shocks, a five-year projection with void-year money shown as future dead money.
- **Moves:** releases with dead money (pre-June 1 accelerates, post-June 1 splits; two
  designations a year), restructures (base → bonus), extensions that keep old proration.
- **Market:** pay follows a player's rank at his position as a share of the cap (top QB ≈ 21%,
  elite non-QBs 13–16%); slotted rookie scale; franchise tags and fifth-year options priced off
  the market with the real formula's lag.
- **Negotiation:** ask = market + agent greed, a hidden walk-away, offers judged on money,
  guarantees, term, a contender's pitch and loyalty; lowballs cost patience, insults double;
  demands never inflate on a counter.
- **Offseason calendar:** re-sign window → five days of free agency → draft → training camp.
  AI GMs (Cap Magician, All-In, Draft and Develop, Can-Kicker, Hard-Liner, Pick Hoarder,
  Balanced) re-sign, tag, bid, draft and cut by numeric traits; rich teams overpay; big deals must
  fit next year's books. `npm run offseason` checks that talent, rosters and caps stay stable.
- **Trades:** Jimmy Johnson vs Fitzgerald-Spielberger pick charts blended by GM style, future
  picks discounted and projected from team strength, players valued as talent × age × term plus
  contract surplus; the AI wants a small win, stays cap-compliant, honours a signing cooldown and
  the week-9 deadline. Contenders and rebuilders trade with each other during the season.

## Roadmap

**✅ Foundation (done)** — 32 teams in the real NFL markets (original nicknames), 53-man rosters, 1–20 ratings, contracts
under a $301.2M cap, NFL-formula schedule, play-by-play engine, standings + tiebreakers,
14-team playoffs, box scores, animated replay viewer, league leaders, depth chart editing, autosave.

**✅ Front office & cap MVP (done)** — year-by-year contracts, dead money, restructures, void
years, cap projections; re-sign window, franchise tag, fifth-year options, extensions; free agency
with negotiation; 7-round draft (260 prospects, scouting grades, AI boards, rookie scale); training
camp cutdowns; trades with AI valuation and pick charts; AI-to-AI deadline trades; drag-to-reorder
depth chart and player avatar slots; realistic end-of-game clock management.

**✅ Attributes & scouting foundation (done)** — attribute registry and contest layer (every rating
the overall counts moves play, `npm run audit`), true vs. perceived ratings with seeded per-team
error, scouting visits, consensus vs. your board in the draft, 0–4 stars with ceiling bands, scout
reports, combine, development history, compare view, position-first ratings with tooltips. The
phased plan behind it is `docs/research/attributes-development-scouting-roadmap.md`.

**✅ Scouting staff & AI perception (done)** — scouting departments with ratings, contracts, a staff
budget, ageing and a market; reads that depend on who's reading; AI teams drafting, signing, cutting
and trading on their own reads; the Staff screen. `npm run offseason` now also reports draft quality
and the staff economy.

**✅ Development v2 & hidden traits (done)** — position aging curves from one table (physical tools
first, the mental game last; QB legs vs arm), per-player body clocks, growth from reps and work
ethic, position-aware retirement, temperament on the line's penalties, makeup read in words by your
scouts, career outlook, "needs reps", AI boards that weigh work ethic, `npm run careers`.

**✅ Coaching staff (done)** — head coach, coordinators, S&C and seven position coaches with youth
development and veteran care ratings that drive growth and aging; a coaching budget, contracts, a
market and an ageing cycle; AI hiring by front-office style and head coaches fired after bad
seasons; play-calling style (pass lean, fourth-down aggression) carried by the coach into games; the
Coaches screen. Then the carousel at NFL turnover rates (promotions, poaching, new head coaches'
staffs, vision and fit), former players going into coaching, retired coaches' careers kept, and
owners with market budgets, patience and a soft coaching budget.

**✅ Injuries & medical staff (done)** — in-game and practice injuries from snaps and collisions,
scaled by hidden injury resistance (fading with age, buffered by a durable body), energy late in
games, condition carried week to week (natural fitness), history and injections. Twenty-seven injury
types with layoffs, a doctor's estimate and permanent scars for the severe ones. Injured reserve (4
weeks, 8 return designations) with AI and optional automatic management. Injury-forced retirements. A
medical staff (doctor, physios, sports scientist) whose physiotherapy shortens layoffs on the spec's
curve and whose sports science prevents strains and restores condition. An injury-risk read in words
from your medical staff or scouts plus public injury reports. The Medical tab, the roster's Fitness
column, the player card's Health section, injuries in box scores. Details and sources:
`docs/INJURIES.md`.

**Next: Front office depth**
- NFL-calendar practice: CBA padded-practice budgets, Full/Limited/DNP, veteran rest days (the
  weekly practice injury roll is the hook).
- Mentoring in position rooms; morale (playing time, contract, results) and holdouts.
- Per-game form (consistency, big games); training camp injuries and the PUP list.
- Compensatory picks, RFA/ERFA tenders, LTBE/NLTBE incentives, conditional picks.
- AI trade offers to the user; trade-down offers during the draft.

**Then: Game day**
- Your game plan: run/pass balance, aggressiveness, coverage shell, blitz rate.
- Rotations by fatigue (energy already drains per snap and drives injury risk), weather, a live
  play-by-play viewer.

**Later**
- Awards: player of the week and month, season awards (MVP, rookie and position honours), all-league
  teams and a hall of fame. Weekly and monthly awards need each week's stats saved as it's played
  (season totals and the last season's box scores are all that's kept today).
- Player morale and personality, media and owner goals; a coaching hall of fame and coaching trees,
  tempo and two-point tendencies.
- Modding: league import/export, an in-game editor, real-roster mods.
- Desktop packaging (Tauri) → itch.io prototype → Steam Early Access.

## Tech choices

- TypeScript + React, built with Vite. The engine is plain TypeScript with no browser
  dependencies, so it can move to a Web Worker, a desktop wrapper (Tauri) or a server unchanged.
- Saves are a single JSON document in IndexedDB. SQLite (via the desktop wrapper) becomes worth
  it once multi-decade careers make saves large.
