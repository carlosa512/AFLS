# Cap room at kickoff and the linemen line (a short follow-up to 0.4.49)

Owner: carlosa512 · 2026-11-16 · follows `2026-11-16-market-and-exits-design.md`

## Intent

Two follow-ups the 0.4.49 market left near an edge. The owner: wrap them up cleanly, aim for the average.

1. **Median cap room at kickoff** fell from main's 0.9–1.0% of the cap (seasons 4–6, four leagues) to 0.5–1.0%. It
   warns under 1% and fails under 0.5%, so a later reshuffle can tip it. NFL clubs carried a median 2.3% into 2025.
2. **Linemen's median retirement age** (`careers`) reads 31 against its 32–36 band and was made soft in 0.4.49.

## What the recon found (one league, eight seasons, main before 0.4.49 against main after)

- **Dead money is the gap.** A team's dead money averaged 5.9% of the cap after, 5.0% before. Spring cuts
  (`springCuts`, new in 0.4.49) went from 0.4% to 1.2%: about the room lost (0.5–0.7 points). Camp cuts rose a little
  (0.9 → 1.4%), trades fell (2.1 → 1.6%).
- **AI clubs never use the June 1 designation.** Every AI release calls `releasePlayer` without it, so a spring cut's
  whole remaining bonus lands this league year. You have two designations a year (`POST_JUNE1_LIMIT`); camp and later
  moves use June 1 accounting on their own (`autoPostJune1`).
- **Good linemen aren't retiring younger.** Starting linemen who retired at 30 or younger: 21 after, 27 before. What
  fell is retirements at 33 and up (13 after, 19 before): the starter lean keeps old starters playing, and fewer old
  retirees pull the median of those who retire down. Backups cycling out of the league is fine (the owner). The exits
  by age that judge good players leaving (starters at 30, 31 and 32) are in band.

## Goals

- Median kickoff room back to at least main's: 1.0% or more in seasons 4–6, read on `npm run offseason -- 6` (this
  league's seasons and the four-league tail). Dead money median stays inside 0–6%.
- The linemen line stops reading as a known issue, and nothing about good linemen changes.
- Everything else holds. The judged lines nearest their edge after 0.4.49: no deal 11% (fails under 10%), clubs with
  3+ good outside signings 8.2–8.8 (fails under 8), kickoff room itself. Fewer cuts mean fewer good free agents, so
  watch those two first.

## Non-goals

- Your own cuts: you keep the June 1 designation as today; nothing here touches your team.
- Pay structure, short-prime exits, starters out of football: separate follow-ups.

## Approaches

- **Cap room (the owner picked both).** 1: AI clubs designate spring cuts post-June 1, as you can. Same tools as the
  player, part of each cut's dead money moves to next year; on its own the steady-state gain is small, since next year
  inherits the rest. 2: a spring cut must save well more than the dead money it leaves, as NFL clubs decide; this cuts
  dead money directly but trims released players (16% now, NFL 20–27%, printed) and outside signings. Both together: the
  designation for the big cuts, and no cut whose dead money eats the saving.
- **Linemen (the owner picked A).** Stop judging the linemen median, keep it printed with why it moved. Rejected: a new
  judged line on starting linemen 29–30 who retire (the age exit lines already judge it).

## The design

1. **June 1 for the AI's spring cuts.** In `springCuts`, while the team has designations left
   (`team.postJune1Used < POST_JUNE1_LIMIT`), a cut is designated post-June 1 when the designation moves money to next
   year (none is spent on a cut with nothing prorated). The cut's room is read with the designation it would get
   (`releasePreview(league, p, designate)`, and `twoYearRoom` with it), so the choice and the room agree, and the most
   room first puts the cuts with the most money to move ahead of the rest.
2. **The dead-money bar.** A spring cut goes ahead only when the dead money it leaves, this year and next, is at most
   `SPRING_CUT.deadShare` of the cap charges it saves over the same two years. Start at 0.5.
3. **Linemen.** In `scripts/careers.ts` the OL median retirement age is printed, never judged, with a comment on why
   (fewer old starters retiring lowers the median of those who do), and no known-issue line. `docs/MVP.md`, `CLAUDE.md`
   and the 0.4.49 spec's follow-up list say so.

## Tuning and stop rule

- Steer with a one-league probe (kickoff room, dead money by source, released share, outside signings, clubs 3+, no
  deal), then judge once with `npm run offseason -- 6`.
- `deadShare` gets at most three rounds. If kickoff room can't reach 1.0% without a judged market line failing, it goes
  back to the owner with the numbers.
- Then `npm run trades` (cap casualties on the phone) and `npm run careers` once (cuts move who leaves football); the
  moved tests are fixed once at the end, by finding their scenes.

## Calls made (mine, for the owner to check)

- Only spring cuts designate post-June 1, not the re-sign window's cap cuts or other AI releases: spring cuts are the
  measured source, and a designation used on a cap cut would not be there for the spring.
- "Saves" in the bar is the cap charges the team no longer pays this year and next; "dead money" is both years' share.
- A fix version: `package.json` 0.4.50.

## What was built (2026-11-16)

- Spring cuts: `designateFor` (post-June 1 where it moves money, two a year) and `cutPaysOff` (`SPRING_CUT.deadShare`
  0.5). Three rounds of the bar (0.5, 0.35, 0.25) barely moved kickoff room, so it stays at 0.5.
- The cushion (the owner's option 2): a probe found it leaks in camp, not free agency's first days (the median AI team
  sat about 4% of the cap above its cushion after free agency; 30 of 31 were under it at kickoff). `CAMP_CUSHION.share`
  caps camp's draws on it (the last call's upgrade swaps, `campStarterSignings`); the stars-only pass keeps the owner's
  rule. Rounds: 0.25 → one season 0.5 (fail); 0 → seasons 4–6 2.2/1.3/1.7, other leagues 1.2/1.3/0.3, nothing fails;
  0.1 → 1.7/1.1/0.9. The owner chose 0. Its cost: starters out of football 7.1 → 7.9% and clubs with 3+ good outside
  signings 8.4 → 8.0 (both warnings).
- Linemen: printed in `careers`, not judged (`PRINTED_RETIRE`).
- CI: the careers job gets 45 minutes (the owner's call, 2026-11-17). Its seasons slow from 11s to 32s as retired players
  pile up in the save, and two runs on slow runners passed 30. The fix, a compact archive for retired players, is next.
- Promote a coordinator in season (below): `promoteCoverProblem`, `promoteCover`, and the open chair's Promote buttons.

## Added: promote a coordinator while the head coach covers (the owner, 2026-11-16)

If you relieve a coordinator in season and let your head coach run that side, the open chair offered only "Find a
coordinator"; promoting from your staff worked only in the offseason staff window. Now, from camp through the regular
season, a coordinator chair your head coach covers can be filled by a position coach on that side who'd step up
(`interimCandidates`, best first) on a one-year deal, under the same budget rule as promoting him while relieving a
coordinator; the head coach stops covering that side. One move, `promoteCover(league, teamId, coachId)`, with its own
check (`promoteCoverProblem`): only a covered chair, only that side's willing coaches, camp through the regular season,
your team only. A coach who'd refuse or the owner protects isn't listed; with nobody, the button is disabled with the
reason.
