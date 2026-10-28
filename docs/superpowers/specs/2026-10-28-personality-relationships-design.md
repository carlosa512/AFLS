# Personality, mentoring, relationships and coaching trees

Date: 2026-10-28 · Branch: `claude/relaxed-archimedes-hyjd24`

## Why

Every player already has a character under the hood (work ethic, temperament, what he wants from a contract), but
the save doesn't feel like a league with history yet. Players don't lead, teach, feud or hold grudges, and coaches
don't come from anyone. This design adds personality, mentoring, relationships and coaching trees in the Football
Manager mould. The main goal is a **living story**: the league should feel like it has history. Consequences stay
light: words on cards, in the inbox, in recaps and in SNN, plus a few small nudges where the game already has a hook.

It builds on the owner's relationships note (Oct 28, 2026) and on mentoring as agreed in `docs/TRAINING.md` §8.

## Decisions (agreed in the brainstorm)

1. **Living story first.** If only one part lands well, it is the sense of a league with history. Mechanics stay small.
2. **Personality reuses what exists, adds four.** The six character traits we have (work ethic, temperament,
   loyalty, wanting to win, greed, patience) plus four new hidden ones: **leadership, poise, controversy and
   sportsmanship**. Adaptability is left out (versatility already covers learning).
3. **About 18 personality names** read off those traits, FM-style. One name per player.
4. **Mentors move three traits:** work ethic, temperament and poise, at most a point a year each.
5. **All five relationships from the note stay**, coach rapport included.
6. **Coaching trees are rare and have a life cycle:** born, hot, steady, withering, faded. A few exist at the start;
   more form over a long save.
7. **Coaching trees touch the carousel:** a head coach brings his people, a hot tree's disciples get a boost in
   head-coach searches, schemes carry on.
8. **Approach A: work it out from history, store only what can't be.** Personality names, rapport, homecomings,
   grudges and trees are worked out when needed. Mentor pairs, friendships, feuds and how a player left a club are
   stored, in short capped lists.
9. **You see it on the player card, a Locker Room tab and the coach card,** always in words, always your staff's read.
10. **The card stays short:** the personality name, one sentence, and at most one more line.
11. **Plain football language everywhere.** No game jargon reaches a screen or a letter.
12. **Four PRs in order:** personality, mentoring, relationships, coaching trees.

## Answers to the note's open questions

| Question | Answer |
| --- | --- |
| Should rapport touch development? | No. Rapport touches habits and contracts. Only mentoring moves a trait, and growth itself is left alone. |
| Relationships on a screen of their own? | Yes: a Locker Room tab on your team, plus one line on the player card. |
| Clashes in the room or the whole locker room? | The position room only, for now. |
| Coaches with each other? | Yes: coaching trees (section 4). |

---

## 1. Personality

### 1.1 The traits

Four new hidden traits go on `Traits`, on the same 1–20 scale (mean 10.5, sd 3.5). They are drawn in
`generateTraits` **after versatility**, so every existing player's six traits stay exactly as they are, and an old
save rolls the new four from the same per-player seed a new save would.

| Trait | Code name | Drawn as | Its job (the hook) |
| --- | --- | --- | --- |
| Leadership | `leads` | its own draw | how much a mentor rubs off (§2), calming feuds in his room (§3.3), captains |
| Poise | `poise` | its own draw | the pressure habits in the marble bag (§1.4) |
| Controversy | `controversy` | leans away from temperament (−0.3) | feud odds (§3.3), speaking out (§3.6) |
| Sportsmanship | `sportsmanship` | leans on temperament (+0.3) | the dirty fouls during a play (§1.5) |

Leadership **does not lean on work ethic**. Mentors are picked by leadership, so if leaders were mostly hard
workers the whole league's work ethic would creep up (`docs/TRAINING.md` §8 holds the league average within ±0.02).
It also makes the Born Leader who coasts, the most dangerous mentor, more common.

Code names avoid two words already taken: `coaching.ts` has `pressureOf()` (how much a defense blitzes) and a
`LEADERSHIP` set (the head coach and coordinators). Screens never name a trait; where text needs the idea it says
"poise" or "leadership" in a sentence.

The existing character traits keep their places: work ethic, temperament and the others on `Traits`; loyalty,
winning, greed and patience on `Personality` (0–1). The names below read all ten as z-scores.

### 1.2 The names

`personalityOf(traits, personality)` in a new `personality.ts` returns one name. Nothing is stored. The rules are
checked in order and the first match wins (z = how many sd from the league average):

| # | Name | Rule (starting thresholds) |
| --- | --- | --- |
| 1 | Locker-Room Lawyer | leadership ≥ +1.0 and controversy ≥ +1.0: the room listens, and he stirs it |
| 2 | Born Leader | leadership ≥ +1.5 |
| 3 | Dirty Player | sportsmanship ≤ −1.5 |
| 4 | Volatile | temperament ≤ −1.0 and controversy ≥ +1.0 |
| 5 | Diva | greed ≥ +1.0 and controversy ≥ +0.5 |
| 6 | Consummate Pro | work ethic ≥ +1.0, temperament ≥ +0.5, sportsmanship ≥ 0 |
| 7 | Clutch | poise ≥ +1.5 |
| 8 | Jittery | poise ≤ −1.5 |
| 9 | Mercenary | greed ≥ +1.0 and loyalty ≤ −0.5 |
| 10 | Ring Chaser | winning ≥ +1.0 and loyalty ≤ −0.5 |
| 11 | Company Man | loyalty ≥ +1.5 |
| 12 | Hothead | temperament ≤ −1.5 |
| 13 | Driven | work ethic ≥ +1.0 and winning ≥ +0.5 |
| 14 | Fiery Competitor | winning ≥ +1.0 and temperament ≤ −0.5 |
| 15 | Quiet Pro | work ethic ≥ +1.0 and leadership ≤ −0.5 |
| 16 | Coaster | work ethic ≤ −1.0 |
| 17 | Easygoing | greed ≤ −0.5, patience ≥ +0.5, winning ≤ 0 |
| 18 | Even-Keeled | everyone else |

**Spread:** a unit test generates a league and pins the shares: Even-Keeled 20–35%, every other name 1.5–9%. The
thresholds above are a starting point; the test decides. Until PR 3 some names are switched off (§6.4), so the test
checks the names switched on at that point.

**A name can change**, but only through mentoring (§2), which shifts work ethic, temperament and poise. A Coaster who
becomes a Quiet Pro is a story: *"He's grown up."*

### 1.3 What a team sees

The name is a scouting read, like today's character tags: it needs knowledge 0.5 (`CHARACTER_KNOWLEDGE`) and is
built from that team's **perceived** traits (`characterRead`, extended to the new four), so your scouts can call a
Mercenary a Ring Chaser. While the read is loose it shows dashed ("early word"). AI front offices use their own read,
never the truth.

### 1.4 Poise in the marble bag

Registry entries that pressure decides get `poise: true`, like today's `temper: true`. To start: **Sees Ghosts**,
**Bails Early** (QB), **Yips Susceptibility** (K) on the bad side and **Ice-Water Veins** (K) on the good side.

In `fillBag`:
- poise z ≤ −1: +1 marble to each bad poise habit at his position (+2 at ≤ −1.5)
- poise z ≥ +1: +1 marble to each good poise habit, and +1 fix marble against each bad one he holds

It is balanced both ways so the league's gain and loss rates hold; `npm run quirks` must stay clean.

### 1.5 Sportsmanship and the flags

Today `discipline(p)` (`match/lineup.ts`) adds temperament to every flag. The split:

| Flag | Reads |
| --- | --- |
| False start, holding, offside, the kick units' fouls | temperament (unchanged) |
| Unsportsmanlike after the whistle | temperament (unchanged): losing his head |
| Roughing the passer, unnecessary roughness, face mask | **sportsmanship**: how he plays |

`personalFouls` in `match/gameSim.ts` gets a `roughness(p)` beside `discipline(p)`: the same contest plus
`0.3 × (sportsmanship − 10.5)` in place of the temperament offset. Both offsets are centred on the league average,
so `DL_DISCIPLINE` and `TACKLER_DISCIPLINE` stay as they are. `npm run sim` and `npm run crews` confirm league
flags hold.

### 1.6 Captains

At the start of camp each team names three captains (offense, defense, special teams): its staff's read of
leadership times standing (starter, years in the league). Captains are a story and the top of the Leaders list
(§5.2); they have no effect of their own.

---

## 2. Mentoring

Everything in `docs/TRAINING.md` §8 stands: it's small, it cuts both ways, it builds week by week on the active 53,
there's one mentor per player and at most two players per mentor, there's a position bonus, and you only see words.
This section adds what personality brings.

### 2.1 Who

- **Mentor:** 27 or older, or 5+ seasons in the league, on the active 53.
- **Young player:** 21–24, on the active 53.
- The staff prefer a mentor from the same position room; the §8 position bonus (×1.1–1.15) applies when the mentor
  plays or played the young player's position (read from `moves`).

### 2.2 What rubs off

Three traits move, each toward the mentor's own: **work ethic, temperament, poise**. Each has an accessor that every
reader goes through: `workEthicOf` (exists), `temperamentOf`, `poiseOf`. The shift is stored beside the trait,
never written into `traits` (traits never change; `npm run careers` relies on that).

At the end of the season, for each of the three:

```
shift = clamp(RATE × weeksTogether / 18 × pull × takes × (mentor − player) / 3.5, −1, +1)
```

- **pull** (how much the room listens to him): his leadership (about ×0.3 for the quietest, ×1.5 for a Born Leader)
  times his standing (starter 1, rotation 0.7, backup 0.4).
- **takes** (how much sticks): lower for a young player with high controversy (Divas and the Volatile take less).
- **cuts both ways:** a mentor below the young player on a trait pulls him down.
- **RATE** is one constant, tuned so a full season with a strong mentor far apart on a trait reaches the 1-point cap,
  and checked against the guard in §2.5.

So a Born Leader who starts pulls hard, and a Born Leader who coasts is the most dangerous mentor in the building.

### 2.3 Who pairs them

- Your position coaches pair your players by default. On the Locker Room tab this shows as *Let the coaches handle
  it*, switched on.
- You can set or change any pair. A pair you set is yours and the staff leave it alone.
- AI teams use the same planner, `planMentors(league, teamId)`, on their own read of their own players.

### 2.4 Stored

- `Player.mentor` (already reserved in `types.ts`) and `mentorWeeks`
- `Player.mentorSetByYou?: true`
- `Player.shifts?: { workEthic?: number; temperament?: number; poise?: number }`
- `Player.mentoredBy?: { id: number; from: number; to: number }[]` (2 entries at most, kept for the card)

### 2.5 The guard

`npm run training` gets the §8 guard for all three traits: per player at most 1 point a year each, and over a
6-season league each league average within ±0.02. If starters (who skew hard-working) still pull the average up,
the first lever is to weigh standing less. The owner signs off on `npm run careers`.

---

## 3. Relationships

### 3.1 Coach rapport (worked out, not stored)

`rapport(league, player, coach)` reads his seasons on that coach's staff (head coach, his side's coordinator or his
position coach) from `statTeams` and coach careers.
- **Good:** seasons together where he played (a starter or rotation role, `seasonRole`) and grew or held his level.
- **Sour:** that coach benched him while healthy (starter to backup), or was head coach when he was cut or traded
  (§3.5's `left`).

| Effect | Size |
| --- | --- |
| Good rapport with a coach now coaching him | 1 fix marble against each bad habit at the refill (2 at most) |
| Good rapport with a coach at a club bidding for him | `offerValue` × 1.03 for that club; loyalty makes it count more |
| Sour rapport with that club's head coach | `offerValue` × 0.97 for that club |

### 3.2 Friendships (stored)

- **How one forms:** at the new league year, two players with 4+ seasons together in the same position room roll a
  chance to become close (higher if both are loyal, so Company Men bond fastest). A mentoring pair that lasted 2+
  seasons becomes a friendship when the mentoring ends.
- **Effect:** while his friend is on the roster, his walk-away price for his own club drops a little (the loyalty
  term in `demand`). A friend at another club makes that club a little more attractive. A Mercenary ignores both.
- **Story:** a word when one of them leaves (*"Banks took Ruiz's release hard."*).
- **Ends:** when one retires.

### 3.3 Feuds (stored)

- **How one forms:** a yearly roll inside each position room, plus events: a benching where the man who took his
  snaps is in the room, or a contract where a roommate got paid and he didn't. Odds rise with controversy and low
  temperament on either side; leaders in the room and a position coach with the Patient Teacher habit lower them.
  There's no "handles people" rating for head coaches, and this design doesn't add one.
- **Effect:** each player gets 1 extra marble toward the temper habits at his position (`temper: true`), at the refill
  and once when the feud starts (`addMarbles`).
- **Story:** your position coach reports it, in his voice.
- **Ends:** one of them leaves the room (trade, cut, position move, retirement), or a yearly roll settles it (likelier
  with calm tempers, leaders in the room, and time).
- **Target:** about one feud per team on average; most rooms have none, and a team rarely has more than three.

### 3.4 Homecomings and grudges (worked out from `left`)

| | When | Effect |
| --- | --- | --- |
| Homecoming | he signs back with a club he left by walking away, after a starter or rotation role there | 1 fix marble his first season back; walk-away price × 0.97 for that club; a homecoming story |
| Grudge | the club cut or traded him, within the last 3 seasons | no loyalty discount and ask × 1.05 for that club; a revenge-game line in the recap when he beats them with a big game (the box score decides) |

### 3.5 How he left (stored)

`Player.left?: { teamId: number; season: number; how: 'cut' | 'traded' | 'walked' }[]`, last 3 only. Written where
it happens: a release (`finance/cap.ts`), `executeTrade`, and signing elsewhere after his deal ran out. Transactions
are text without a player id, so this can't be worked out after the fact.

### 3.6 Speaking out

After a benching, a trade or a contract snub (a lowball, a tag), a player with high controversy may go public: an SNN
item, or a letter if he's yours. It's story, plus the event's push on feud odds in that room (§3.3). Never a "needs
you".

### 3.7 Stored, all together

`Player.ties?: { kind: 'friend' | 'feud'; with: number; since: number }[]`, at most 3 per player, cleared at
retirement. With `left` and the mentoring fields, the estimate is a few thousand small records across a league. It
barely moves the save.

---

## 4. Coaching trees

### 4.1 Links take time

A coach is **linked** to a head coach after **3+ seasons on his staff** (any chair), or to a coordinator after 3+
seasons as a position coach on that coordinator's side of the ball. A shorter stop is a line on his résumé, not a
branch. This is deliberately stricter than the NFL press, which counts a single season (Brandon Staley's one year as
McVay's DC puts him in McVay's tree): the owner wants trees to be rare and earned. Links are worked out from `Coach.career` (and `pastUnder`, §4.5) by `coachTree(league, id)` in a new
`trees.ts`, cached once per league year (careers only change at hires and season's end).

A coach's **main branch** is the head coach he served under longest (most recent breaks a tie).

### 4.2 A tree is rare

A head coach has a **tree** only once **two of his linked assistants have become head coaches**. Before that he's a
coach with former assistants, nothing more. A disciple who reaches two head coaches of his own starts a branch, so
trees nest over a long save (Walsh → Holmgren → Reid).

### 4.3 Standing

Worked out from the results of the tree's active head coaches (§4.6 has the numbers):

| Standing | When | What it does | In words |
| --- | --- | --- | --- |
| Hot | its head coaches are winning now | a boost in head-coach searches for its disciples | *"the hottest tree in the league"* |
| Steady | mixed results | a small boost | *"a respected tree"* |
| Withering | its head coaches keep getting fired with losing records | a knock in searches | *"another Haskins disciple?"* |
| Faded | no active head coach from it for several seasons | history only | *"one of the great trees of its day"* |

### 4.4 The carousel

Small terms on the scoring that already exists in `coaching.ts`, and only through real links:

1. **He brings his people.** In `cleanHouse`, a coordinator linked to the new head coach stays more often. Filling a
   chair, candidates linked to the head coach score better, from the market, promotions and poaching alike.
2. **Searches follow standing.** Head-coach searches give a hot tree's disciples a boost and a withering tree's a
   knock.
3. **Schemes carry on.** When a coach first becomes a coordinator, his scheme rolls leaning toward his main mentor's.
   A new head coach's vision (`headCoachVision`) leans toward his mentor's. Both stay pure functions of the seed and
   careers. `npm run sim` and `npm run offseason` confirm league totals hold even when similar schemes cluster.

### 4.5 The first trees

At league creation a few founding roots are chosen: some senior head coaches, and some retired legends (new entries
in `league.retiredCoaches`). Some of today's head coaches and coordinators get pre-league tenure under them, enough
that each founding tree starts with two active head coaches. That history goes in
`Coach.pastUnder?: { coachId: number; role: CoachRole; seasons: number }[]`, not in fake career rows, so no one's
record (`records.ts`) is inflated. Old saves get the same seeding when they upgrade.

### 4.6 Numbers from the NFL

The research behind the targets below is in `docs/research/coaching-trees.md`.

Sources and our own estimates are in `docs/research/coaching-trees.md`. A tree's active head coaches include its
branches (disciples' disciples), the way Walsh's tree still counted McVay. `npm run careers` (four leagues, 16
seasons) checks these:

| Measure | Target | Why |
| --- | --- | --- |
| Live trees (2+ active head coaches) | 2–5 in a league at any time | 4–5 in 2025 on loose links; one big tree at a time before 2017 |
| The biggest tree | 3–6 active head coaches | Reid's 4–5; our 3-season links keep trees under Shanahan/McVay's 11 |
| Head coaches in a live tree | 15–40% of the 32 | strict counts, well under the press's loose ones |
| Head-coach hires from a tree | 10–35% over a decade; a hot tree up to 40% of one offseason | about one hire in five from the hottest tree; 4 of 10 at the 2026 peak |
| New trees born | 1–4 per league over 16 seasons | about one disciple in five to eight starts his own |
| Founding trees still alive at season 16 | at least one per league (through any branch) | trees outlive their roots by 20–30 years |

**Standing thresholds** (combined win share of the tree's active head coaches):

| Standing | Rule | Real-world anchor |
| --- | --- | --- |
| Hot | .550 or better over the last 3 seasons | McVay's disciples .582, Reid's .550 |
| Withering | .450 or worse over the last 5 seasons, with 2+ disciples fired in that time | Belichick's .413 |
| Steady | anything between | |
| Faded | no active head coach in the tree, branches included, for 4 seasons | Dungy's tree after Tomlin |

**At the start:** 3–4 founding roots, one or two of them retired legends, each with two active head coaches, so 6–8
of the 32 head coaches start in a tree.

The size of the search boost and knock (§4.4) is tuned until the hire share lands in its range; it is not a number
from the research.

### 4.7 The story

- The coach card shows his tree: who he learned under, who came off his staff, and how the tree is doing, in words.
- SNN: a tree being born (the second head coach off a staff), the first mentor-against-disciple game, a root retiring.
- The existing "coach hired away" letter adds the tree: *"Price leaves to run Miami, the third head coach off your
  staff in five years."*
- A former player who coaches under his old head coach: *"played for Haskins, now coaches for him."*
- Later, the coaching hall of fame on the roadmap can rank trees.

---

## 5. What you see

### 5.1 The player card

The character block replaces today's work-ethic and temperament tags (body and versatility notes stay as they are):

1. **The personality name**, dashed while your scouts are unsure.
2. **One sentence** on the one or two traits that stand out most, in the scouts' words: *"Outworks everyone and keeps
   his cool."*
3. **At most one more line**, the one that matters most right now, in this order:
   1. a feud he's in;
   2. a grudge, when you're dealing with that club;
   3. his mentor (*"Learning from Okafor"*, later *"Learned from Okafor (2027–29)"*);
   4. a close friend.

The full picture lives on the Locker Room tab. A screen test enforces the one-extra-line rule.

Starting wording for the sentence, one phrase per trait at each end:

| Trait | High | Low |
| --- | --- | --- |
| Work ethic | outworks everyone | has to be pushed |
| Temperament | keeps his cool | loses his head |
| Leadership | the room follows him | keeps to himself |
| Poise | wants the ball late | tightens up when it counts |
| Controversy | says what he thinks, to anyone | never a word out of place |
| Sportsmanship | plays it clean | plays past the whistle |
| Loyalty | wants to stay put | no ties to anywhere |
| Wanting to win | wants a ring | happy wherever |
| Greed | wants top dollar | not about the money |

### 5.2 Team › Locker Room

Your team only; you can't see inside another club's room.

- **Leaders:** the captains, then who the room follows.
- **Mentoring:** each pair and how it's going (*"learning well"*, *"early days"*, *"not taking"*), *Let the coaches
  handle it* (on by default) and a way to set or change a pair.
- **In the room:** friendships and feuds, by position group.

Everything is worded as your coaches' read (*"the way our coaches see it"*).

### 5.3 The coach card

His tree, if he's in one (§4.7). Nothing for a coach without links.

### 5.4 Mail, news and recaps

Each sender keeps their voice (`inbox.ts`): your position coach reports a feud, the head coach names the captains,
an agent says *"he'd like to come home"*, SNN carries players speaking out and the tree stories. Recaps get a clutch
line or a revenge line only when the box score backs it up. Mail is keyed by what it's about, so nothing doubles up.

**No new chores:** nothing in this design is ever "needs you". A feud is news, and the staff handle mentoring unless
you step in.

### 5.5 Words

Screens and letters talk like football people. A screen-contract test in `ui/ui.test.ts` lists the words from under
the hood that must never reach a screen: *marble, trait, z-score*, and code names such as `workEthic` or `leads`.
The list stays short on purpose: words like *score*, *standings* or *shift* are everyday football and must stay
usable. Every PR in this design ends with a wording pass over its new text.

---

## 6. Data, checks and build order

### 6.1 Save

One `SAVE_VERSION` bump in PR 1 adds the four traits (rolled from each player's seed). Each later PR that
adds a field bumps again with its own `migrate.ts` step: empty lists for players, founding trees seeded for coaches
(PR 4). Old saves are upgraded, never thrown away. `League` stays plain JSON.

### 6.2 Modules

| Module | Owns |
| --- | --- |
| `traits.ts` | the four new traits, `temperamentOf`, `poiseOf` (beside `workEthicOf`) |
| `personality.ts` (new) | `personalityOf`, the card sentence, captains |
| `mentoring.ts` (new) | who can mentor, pull, weeks together (the weekly training tick), the season-end shift, `planMentors` |
| `relationships.ts` (new) | rapport, friendships, feuds, homecomings, grudges, speaking out, the bag and contract nudges |
| `trees.ts` (new) | links, trees, standing, founding trees, the carousel terms `coaching.ts` reads |

### 6.3 Checks

| Check | What it holds |
| --- | --- |
| Unit tests | the name spread; the six old traits unchanged by generation; the caps (3 ties, 2 young players per mentor, 3 `left`) |
| `npm run training` | mentoring: at most 1 point a year per trait; league averages within ±0.02 over 6 seasons |
| `npm run quirks` | habit rates in range with poise, feud, rapport and homecoming marbles |
| `npm run sim`, `npm run crews` | league flags hold after the sportsmanship split and with mentored temperament |
| `npm run careers` | owner signs off on mentoring; tree numbers against §4.6 |
| `npm run offseason` | contract nudges leave cap health and rosters stable |
| Screen tests | the banned words; the one-extra-line card rule |

### 6.4 Build order

Four PRs, each usable on its own:

1. **Personality.** All four traits, the names, the card block, the sportsmanship split and poise in the bag.
   Names that depend on leadership or controversy (Locker-Room Lawyer, Born Leader, Volatile, Diva, Quiet Pro) stay
   switched off until the PR that gives that trait its job, so nothing on screen is for show.
2. **Mentoring.** Leadership gets its job. The Locker Room tab arrives with Leaders and Mentoring. Captains.
3. **Relationships.** Feuds (controversy's job), friendships, rapport, homecomings, grudges, speaking out, and
   "In the room".
4. **Coaching trees.** Links, trees, standing, founding trees, the carousel and the coach card.

None of this is an MVP item in `docs/MVP.md`; each PR bumps the patch number per `docs/VERSIONING.md`, with a
changelog entry.

## Left for later

- Feuds reaching the whole locker room.
- A one-game "distracted" state.
- Rapport touching development.
- Morale and holdouts (roadmap), which would read these traits.
- Adaptability, if a "settling in" system ever needs it.
