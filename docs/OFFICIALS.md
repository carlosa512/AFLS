# Officiating crews

> **Status.** MVP built: 17 crews with fictional head referees and three hidden tendencies (Flag
> Volume, Holding, Coverage), centred so the league calls what it always did, nudged up to two points
> each offseason (`officials.ts`). Every penalty roll in `match/gameSim.ts` is multiplied by the
> crew's tendencies, the same for both teams, and every enforced penalty is logged by kind on the box
> score (`TeamGameStats.flags`). Crews rotate week by week (sixteen games each, never two in a week),
> and the crew working a game is shown on the next-game card; the Officials tab under Stats ranks
> every crew on flags, holding and coverage calls per game; the box score breaks a game's penalties
> down by team and kind beside the crew's season average. Checked by `npm run crews`.
>
> Not yet: everything under Later phases.

# AFLS Referee Crew System Spec

Oct 18, 2026 · @Carlos Ancira

## Summary

AFLS gets 17 fictional officiating crews. Each crew has hidden tendencies that nudge how often
certain penalties get called. Players never see the numbers, but they can see each crew's stats and
learn its habits.

**Design rule:** hidden inputs are fine, unexplainable outcomes are not. Every crew effect must show
up in a stat the player can read.

## Reference

FM proves this works as a small depth layer. The real NFL proves crews genuinely differ, and teams
already scout them.

|  | Football Manager | Real NFL |
| --- | --- | --- |
| Who | Individual refs with hidden 1-20 attributes | 17 crews, each led by a head referee |
| Main lever | Discipline (cards per match) | Total flags, holding, coverage calls |
| Spread | About 1 to 4-5 yellows per match, by Discipline | 13.1 to 20.4 flags per game across crews (2018) |
| How you counter it | Tackling instructions like Stay On Feet | Teams track crew tendencies |
| Known problem | Unresearched leagues get random refs, sometimes all lenient | Playoff crews are mixed, so tendencies blur |

Sources (search results, not re-verified): [Steam FM2019 thread](https://steamcommunity.com/app/872790/discussions/0/1629663273600652265),
[SI forum: Referee Mods](https://community.sports-interactive.com/forums/topic/197969-referee-mods/),
[ESPN: 2018 crew tendencies](https://africa.espn.com/blog/nflnation/post/_/id/291449/scouting-nfl-officiating-for-the-playoffs-everything-you-need-to-know),
[ESPN: holding depends on the referee](https://africa.espn.com/blog/nflnation/post/_/id/148513/inside-slant-offensive-holding-depends-on-the-referee)

## MVP scope

Ship crews with three attributes, a pre-game line, and a stats page. Nothing else.

**In:**

- 17 generated crews with fictional head-ref names
- 3 hidden attributes: Flag Volume, Holding, Coverage
- One crew assigned to each game, shown before kickoff
- Crew stats page and a post-game penalty breakdown

**Out** (see Later phases): staff scouting reports, home lean, QB protection, consistency, playoff
crews, game plan hooks, media stories.

## Data model

`League` is one plain JSON object, so the spec's two tables are a list and a field:

- `league.crews: Crew[]` (by id): `{ id, firstName, lastName, flagVolume, holding, coverage }`, the
  tendencies 1–20.
- `GameResult.crewId`: the crew that worked the game, stored when it's played. Until then the crew is
  a pure function of the seed and the schedule (`crewAssignments`), like weather.
- `TeamGameStats.flags`: each team's enforced penalties by kind (`falseStart`, `offside`, `holding`,
  `passInterference`, `defHolding`). This is the penalty log; crew stats are a query over it
  (`crewSeason`), so there is no stats table.

Saves from v14 and earlier get the crews a new league would get from their seed (`migrate.ts`, v15).
Games they already played have no crew and no penalties by kind, so the crews' numbers start with the
next game. Box scores are kept for the current and last season only, so that's how far back crew
stats go.

## Engine integration

The crew is just a multiplier on penalty rolls the engine already makes. No new engine logic.

1. Turn each attribute into a multiplier from 0.80 (at 1) to 1.20 (at 20). Average crews sit near 1.00.
2. Flag Volume multiplies every penalty roll (false start, offside, holding, pass interference,
   defensive holding).
3. Holding multiplies offensive holding rolls.
4. Coverage multiplies pass interference and defensive holding rolls (the engine has no separate
   illegal contact).
5. Both teams get the same multipliers. The crew changes the game's texture, not who it favors.

```latex
p_{call} = p_{base} \cdot m_{volume} \cdot m_{category}, \quad m = 0.8 + 0.4 \cdot \frac{attr - 1}{19}
```

The Flag Volume range alone gives a 1.5x gap between the busiest and quietest crew, close to the real
2018 gap (20.4 vs 13.1 flags per game). The worst case on one category is 1.44x.

## UI

Three touchpoints, all reading the same penalty data. Hidden attributes are never shown.

- **Pre-game:** one line on the next-game card, like "Crew: R. Halvorsen (4th most flags per game)".
  The rank is this season's once the crew has worked 3 games, otherwise last season's ("… last
  season"). Like the NFL, only the current week's crew is known.
- **Crew page** (Stats → Officials): games worked, flags per game, holding per game, coverage flags per
  game, each with a league rank; sortable, by season, with your next game's crew marked.
- **Post-game** (box score → Officials): penalties by team and kind, with the crew's season average
  beside each.

## Guardrails and balance targets

The league as a whole must stay at baseline. Only individual crews drift.

- **Normalize:** after generating crews, shift attributes a point at a time until each one's league
  mean is 10.5 (to the nearest point of the total). This avoids FM's all-lenient-league problem.
- **Spread:** new crews take one slice each of 4–17, so every league has strict and lenient crews.
  It's narrower than 1–20 on purpose: sixteen games a crew add their own luck, about ±0.15 on the
  busiest-to-quietest ratio in one season, and the two together land on the NFL's gap.
- **Rotation:** each week the crews who have worked the fewest games take the field (ties by a
  seeded draw), so every crew works about sixteen games and never two in a week.
- **Small samples:** hide league ranks until a crew has worked 3 games.
- **Stability:** attributes are fixed for a season. Each offseason, nudge each one by up to 2 points,
  leaning a little back toward the centre (without it, the crews would spread further apart every
  year), then normalize again.
- **Self-check** (`npm run crews`): play four leagues for a season, replaying every game with a
  league-average crew too; league flags per game must be within 5% of that baseline, and the
  busiest-to-quietest crew ratio between 1.3x and 1.7x (averaged over the four, each shown). It also
  checks the rotation, the centring, and thirty years of drift.

## Later phases

Each of these waits until the MVP proves players notice and enjoy crews at all.

| Feature | Why it waits |
| --- | --- |
| Staff scouting reports (accuracy by staff skill) | Needs a staff system; the biggest upgrade over FM |
| Game plan hooks and player traits ("grabby" OL, "handsy" CB) | Needs game plan sliders and traits |
| QB protection (roughing the passer) | Needs pass-rush penalties modeled |
| Home lean | Easy to feel rigged; tune only after feedback |
| Consistency and big-game composure | Adds noise before players can read the basics |
| Mixed all-star playoff crews | Needs playoffs |
| Media and fan stories on bad calls | Needs a media system |

Since this was written, some of these have their groundwork: scouting staff exist (`staff.ts`), the
`handsy` and `handPlacement` quirks already draw more flags, and the playoffs are built (crews work
them in the same rotation for now).

## Open questions

- [x] Does the match engine roll penalties per play yet, and does it log them by type? It rolled five
  kinds (false start and offside before the snap; holding, pass interference and defensive holding
  during it) but only kept team totals. It now logs each by kind.
- [x] Is there a game preview screen to hold the crew line, or does it go on the schedule? The Home
  screen's next-game card, beside the forecast.
- [x] Real ref names in the private mirror layer, or fictional in both layers? Fictional, drawn from
  the moddable name pools (`data/names.ts`); real names are a community mod concern, like players'.

## Checks left red when crews landed (handle separately)

Crews change each game's random path, so every league plays out differently from before. Two numbers
that already sat near their limits on `main` (a713be0) went over. Neither is caused by the crews
themselves; both were left as they are on purpose, to be handled on their own.

**1. `npm run quirks -- --effects`: Pat-The-Rock (`patsTheBall`) flagged NO EFFECT.**

| Run | sack% change | z | Verdict |
| --- | --- | --- | --- |
| `main`, 3 + 9 seasons | +0.25 | 2.6 | weak (passes) |
| crews, 3 + 9 seasons | +0.16 | 1.8 | NO EFFECT (fails) |
| crews switched off (`league.crews = []`), 3 + 9 seasons | +0.25 | 2.6 | identical to `main` |
| crews, 6 + 18 seasons | +0.23 | 3.5 | moves play |

The effect is real. At the check's sample its expected z is about 2.5 against a bar of 2, so it fails
roughly 30% of the time whenever the engine's games change. Ideas: give an inconclusive quirk a bigger
sample before flagging it (same bar, more evidence), or make the quirk a little stronger (`d += 0.3` on
pressure in `match/gameSim.ts`).

**2. `npm run careers`: long-run points per team-game 24.15, band 21–24.**

`main` reads 23.64 (penalties 5.43, sacks 2.17); with crews it's 24.15 (penalties 5.47, sacks 2.24).
Replaying 4,896 fresh-league games with each game's crew and with a league-average crew (same seed,
same rosters) gives 22.50 against 22.45 points, a difference of +0.05 ± 0.08: crews add nothing
measurable. The 16-season leagues simply took different paths. Fresh leagues (`npm run sim -- 10`)
went 22.47 → 22.68, inside 21.5–23.5. The long-run number has crept up over time (21.99 when the
careers band was set, 23.64 on `main`), so a small scoring tune for aged leagues may be the real fix.
