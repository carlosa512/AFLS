# Names

> **Status.** Built: heritage-weighted names for players (by position), coaches, scouts, medical staff
> and referees, women on scouting and medical staffs, and the v27 pass that renames people in older
> saves. Code: `src/engine/identity.ts` (the picker), `src/engine/rename.ts` (the old-save pass),
> `src/engine/data/names.ts` (the pools), `src/engine/data/heritage.ts` (who draws from which pool).
> Tested in `identity.test.ts`, `rename.test.ts` and `women.test.ts`.

## 1. Why

A league should sound like the NFL. A uniform pick from one small list made a Patel as likely at
quarterback as a Washington at corner, and every staff member sounded like a 2000s draft class. Names now
follow the real makeup of each job: who plays each position, who coaches, scouts, treats players and
referees, and the names people of that background and generation actually carry. Nothing is ever zero:
an unlikely name stays possible.

**Heritage is only ever a step toward a name.** It is drawn, used to pick the name, and thrown away. It is
never stored, no screen shows it, and nothing in the sim reads it: ratings, development, contracts and
the avatars (a grey mannequin) are untouched.

## 2. How a name is drawn

1. **Woman or man.** Scouts and medics only, at their chair's share (section 4). Coaches stay men.
2. **Heritage**, from the role's mix (`data/heritage.ts`): players by position, coaches by chair, scouts,
   medics (and women in each field) and referees.
3. **First name**, from that heritage's list for the person's **generation**: players were born around
   2000 (Jaylen, Caleb, Mateo), staff and referees a generation earlier (Mike, Darrell, Carlos). Women's
   names for women.
4. **Surname**, from the same heritage, or from a second draw of the mix for 12% of people
   (`MIXED_SURNAME`): mixed families, adoption, marriage.
5. **Redraws** for a real NFL name (`RESERVED_FULL_NAMES`), a first name repeated as the surname, or a
   surname a referee crew already has.

Weights come from the pools' counts, flattened (`FLATTEN`, 0.6): the lists hold the head of each real
distribution, not its long tail, so unflattened Smith would be one white player in eleven. Shared full
names stay rare (a shared name shows as plain text in mail, since it can't link).

**Seeds.** A name costs the caller's random stream exactly two draws, as the old picks did, so every
other roll in a seeded league lands where it always has; the draw runs on a stream seeded from those two.
Traits, quirks and the combine are seeded by the player's name, so a new league's players get different
(equally likely) hidden traits than before this pass.

## 3. The mixes

Estimates anchored on the published figures in section 6. Rows are relative weights.

**Players by position**

| Pos | White | Black | Hispanic | Pacific Isl. | Asian | Native | African-immigrant | International |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QB | 54 | 37 | 3 | 2 | 1 | 1 | 1 | 1 |
| RB | 15 | 74 | 3 | 1 | 0.3 | 0.3 | 4 | 3 |
| WR | 16 | 70 | 3 | 1 | 0.3 | 0.3 | 6 | 4 |
| TE | 47 | 39 | 3 | 3 | 0.3 | 1 | 4 | 3 |
| OL | 38 | 43 | 3 | 7 | 0.3 | 1 | 5 | 3 |
| DT | 20 | 56 | 3 | 8 | 0.3 | 0.5 | 10 | 3 |
| EDGE | 22 | 60 | 2 | 3 | 0.3 | 0.3 | 10 | 3 |
| LB | 26 | 57 | 4 | 4 | 0.3 | 1 | 6 | 2 |
| CB | 4 | 86 | 1 | 1 | 0.3 | 0.3 | 6 | 2 |
| S | 14 | 74 | 2 | 2 | 0.3 | 0.3 | 5 | 3 |
| K | 80 | 3 | 5 | 1 | 3 | 0.3 | 0.3 | 8 |
| P | 68 | 2 | 2 | 2 | 1 | 0.3 | 0.3 | 25 |

A new league comes out about 59% Black, 6% African-immigrant heritage, 26% white, 3% Hispanic, 3%
international, 2.5% Pacific Islander and 0.4% Asian (TIDES 2023: 53.5% Black, 1.8% Pacific Islander, 0.1%
Asian, plus a growing two-or-more-races group). The commonest surnames are Johnson and Williams, each
about 1.5% of players, as on real rosters, and about 2% of people share a full name with someone.

**Staff and referees**

| Chair | White | Black | Hispanic | Pacific Isl. | Asian | Other |
| --- | --- | --- | --- | --- | --- | --- |
| Head coach | 75 | 16 | 5 | 1 | 2 | 1.5 |
| Coordinators | 70 | 22 | 3 | 1 | 2 | 2 |
| Position coaches | 56 | 37 | 2 | 1.5 | 1.5 | 2 |
| Strength & conditioning | 65 | 25 | 3 | 2 | 2 | 3 |
| Director of scouting | 72 | 20 | 3 | 0.5 | 2 | 2.5 |
| Scouts | 65 | 25 | 4 | 1 | 2 | 3 |
| Head team doctor | 88 | 4 | 2 | 0.3 | 5 | 1.2 |
| Physiotherapists | 80 | 8 | 4 | 1 | 5 | 2 |
| Sports scientists | 72 | 6 | 6 | 1 | 10 | 5 |
| Referees | 74 | 19 | 2 | 1 | 2 | 2 |

## 4. Women on staff

| Chair | Share | Their mix |
| --- | --- | --- |
| Director of scouting | 3% | scouting: 55 white, 25 Black, 8 Hispanic, 6 Asian, the rest spread |
| College and pro scouts | 7% | scouting |
| Head team doctor | 3% | 80 white, 9 Asian, 5 Black, 4 Hispanic |
| Physiotherapists | 15% | 72 white, 9 Asian, 8 Hispanic, 6 Black |
| Sports scientists | 25% | 68 white, 12 Asian, 8 Hispanic, 6 Black |

That's roughly one woman on every other team's medical staff and a woman scout every couple of teams.
The flag (`woman?: true`) is set once at creation, with the name, and every line about a scout or medic
uses her pronouns (`engine/pronouns.ts`). Coaches stay 0 for now.

## 5. Older saves (v27)

- **Who's renamed:** everyone the old pools named. A player whose name was typed in the identity editor
  is kept: his traits are seeded by the name he was generated with, so a renamed player no longer matches
  them; a name outside the old pools is kept too. Kept names are flagged (`nameEdited`), and the editor
  sets the flag from now on, so no later pass touches them.
- **Same draws as a new league:** scouts and medics can come out women, at the same shares.
- **History follows:** transactions, mail (subject, body, sender, and the trade mail keyed by its
  transaction), rumors, physicals, severance and play-by-play are rewritten to the new names in one
  pass, so names still link to the right card. A name two people shared stays as it was (it never
  linked). A former player who coaches keeps his playing name, the new one.

## 6. Sources and confidence

This pass could not download primary tables: the session's network blocked census.gov, ssa.gov and
tidesport.org, so the numbers come from secondary coverage of them and from known rankings.

- **Players:** TIDES NFL Racial and Gender Report Card 2023 (53.5% Black, 1.8% Pacific Islander, 0.1%
  Asian, about two thirds people of color), Week 1 starting quarterbacks (16 of 32 Black in 2025),
  kickers and punters about 98% white (TIDES 2014), Marquez-Velarde et al. 2023 (position trends,
  1960-2020), Polynesian heritage counts (about 50 Samoan-descent players), the NFL's 130+ players of
  African descent, Australian punters.
- **Staff:** TIDES 2023 (assistant coaches 43.6% people of color, 36.9% Black; head coaches), team
  physicians (Gillikin et al. 2023: 91.2% white, 2.4% women), NATA membership (80% white), athletic
  trainers (about 20 women among 100+ NFL ATs, 2022-23), 33 women scouts (AP, 2022), officials (2022
  report card: about a quarter people of color, 5 women).
- **Names:** surname weights approximate the 2010 Census surname file (count times each group's share:
  Washington about 87% Black, Garcia and Martinez about 92-93% Hispanic); first names follow Social
  Security popularity by birth decade, with names characteristic of each community from roster and
  community-name research.

Cells nobody publishes (most position splits, scouts, strength coaches, the mix among women) are
estimates between those anchors. To refine: replace the weights in `data/names.ts` and the mixes in
`data/heritage.ts` from the downloaded files (Census `Names_2010Census.csv`, SSA `yob*.txt`, the TIDES
PDFs). No code changes are needed.

## 7. Tunables

`FLATTEN` (0.6) and `TRIES` (30) in `identity.ts`; `MIXED_SURNAME` (12%), every mix and `WOMEN_SHARE` in
`data/heritage.ts`; the pools and `RESERVED_FULL_NAMES` in `data/names.ts`. All moddable.
