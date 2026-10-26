# News cycle

The inbox remains a manager's desk: personal letters carry management decisions, and occasional public
reporting explains the league. Delivery still happens after `store.mutate`; the simulation never sends mail.

## Editorial rules

- SNN — Sports News Network reports late division-lead changes in the user's division. It uses the same
  standings and tiebreakers as the standings screen and never turns provisional first place into a clinch.
- The Arena Gazette is the numbers desk (`gazette.ts`): SNN reports what happened, the Gazette explains it with the
  open measures in `analytics.ts`: EPA per play and per dropback (the stand-ins for DVOA and QBR, which are
  proprietary), success rate (40% of the distance on first down, 60% on second, all of it on third and fourth) and
  explosive plays (runs of 10+, completions of 20+). The match engine counts them as each play resolves
  (`TeamGameStats.adv`; `dropbacks`, `epa`, `successes`, `rushSnaps` on players) and they never move play. Expected
  points come from a fixed table fitted to the engine's own games, with fourth down valued as what follows it (a punt,
  a field-goal try or going for it, the best of the three: punts and kicks never pass the counting point); `npm run
  sim` prints the league's numbers against the NFL's as warnings.
- A column runs after weeks 4, 7, 10, 13 and 16, with a playoff preview and a season wrap: filed only at its moment
  (no backfill), with or without a job, never Needs you. Each has one story, chosen by the first condition that
  holds (a club leading a measure by a quarter of the spread to tenth; our club top or bottom three; the biggest
  offensive mover since the last column actually filed, ten places or more; a top-five offense with a bottom-five defense or the
  reverse; a turnaround from last season (.750 after six wins or fewer, .375 after ten or more); otherwise the
  league's state), a paragraph on the tables and a line locating our club, then two or three tables on rotating
  themes (top five, bottom three and our row; players top ten). Samples: every club needs three counted games; a
  passer 12 dropbacks, a rusher 6 carries and a pass rusher 15 rush snaps per team game. Tables are saved with the
  column. The turnaround replaced the Gazette's old trajectory stories.
- SNN lead-change stories finish with one supporting table: division standings or the featured team’s
  current stats, with year-over-year comparisons reserved for exceptional changes. The choice is saved
  with the article and alternates deterministically when neither view has a special claim. Stories add the
  latest result when available. The article leads with the result that changed the race, connects it
  to a meaningful streak, and closes with the next fixture or the user team’s position. Short paragraphs
  leave statistical detail to the tables rather than repeating each row in prose. Names in the tables and medical availability cards open the relevant cards.
- Important completed trades can receive an SNN article with a table of exactly what each club receives,
  including draft years/rounds and retained salary. The headline uses the highest-rated notable traded
  player on the user scouts’ read; up to three other active names can appear beneath the deal. Selection requires a modeled star deal, an early-round
  pick or a strong scouted player, and complete asset records. Public rumors use recorded shopping/interest only; completed moves and
  closed windows suppress stale rumors. The user's own deals keep their personal confirmation instead. When the
  seller has played and sits at .500 or worse, the story adds its record: "The Squall, 1–3, are selling."
- SNN tells the league's trade stories. The director of scouting doesn't retell them: four times a year he
  recommends two to four moves for us (`directorAdvice.ts`): three weeks before the deadline (week 6), in deadline
  week, when the league year opens (other clubs' players whose deals have run out, and a trade target) and on free
  agency's first day (the free agents our cap can carry). In season he leans from the playoff race: holding a seed or
  within a game, add; two or three games out, one in and one out; further, sell (players clubs asked about first,
  then veteran starters on expiring deals). Each pick is read through our scouts (knowledge 0.35 or more), comes from
  what is public (a club the market shows selling, a shopping rumor; never a private trade block), and carries one
  line on why, a ballpark ("likely a 4th", "asking about $6.2M a year") and a button that loads the trade table or
  opens free agency. With nothing worth it, the in-season mail says "we hold" and the offseason one isn't filed.
  The league office's only deadline notice is deadline day's.
- Other clubs' in-season coaching and front-office changes reach the inbox as one SNN roundup per week ("Coaching
  changes: HOU, CIN"); a lone change stays its own story, and our own club's come from the owner.
- Other clubs' offseason front-office changes (GMs let go, retired, hired or extended, hot-seat reporting, interim
  head-coach calls) arrive as one SNN digest per offseason step: "Front-office carousel: 4 GMs out, 3 hired, 6 on
  the hot seat", a short lead and a grouped table (Out, Hired, Extended, Hot seat, Interim head coaches) saved with
  the mail. The id names the events it carried (`leadership-phase:season:phase:first-last`), so a later change starts
  a new digest and a save that filed single stories gets nothing twice. A lone change stays its own story. The
  coaching carousel is SNN's too; the league office keeps official notices about our club.
- The owner sends one letter per league year: his verdict when it isn't plain "back", the user's contract when it's
  up, then the budgets. Our own offseason warning, coach-change and extension events send no other mail. When the
  user's deal has run out and the owner keeps him, it is an offer, not a silent extension: two years, one on a
  warning. It is Needs you and blocks the staffing window; declining ends the job and opens the GM job market, with
  the guaranteed way back and never the old club.
- Outlets carry fixed badges in the inbox (SNN, GAZ, LO, OWN) rather than initials of their names.
- One public headline at most is selected for the latest fully completed regular-season week. There is
  no minimum quota. Division stories take precedence, then key trades and public rumors (the Gazette's turnarounds
  live in its numbers column).
  Trade editions cover non-overlapping windows: Weeks 1–2, 3–4, 5–6, 7–8, then Week 9. A separate
  deadline-day edition requires new important activity on that day; it never repeats Week 9’s deals.
  The user’s own transactions are excluded, and completed trades suppress related rumors. No weekly backfill after
  a long advance; already delivered stories retain their original text. Checkpoints count games, not weeks.
- The scouting director revisits the user's actual drafted class after its eighth game and when its
  regular season is finished. A long advance to the end gets the season review, not a late midpoint report.
  Only work for the drafting club is counted, using box-score team IDs. Scrimmage snaps keep offensive
  linemen visible; kicking and punting have their own production. A short lead introduces a sortable table
  of every selection: pick, player, scrimmage snaps, production and role context. Generic snap averages are
  replaced by best-game highlights, spot-work notes or the teammate carrying the load. Notes can show a workload
  rise after a documented teammate injury, the teammate carrying the work, or an unusually strong/weak
  production rate relative to at least three qualifying rookies at the same position. No unrecorded preseason
  expectations or private depth-chart motives are invented. No old snap history is reconstructed.
- Opposition reports select at most two contests, with a scouting explanation and season statistics
  (sack rates, yards per carry or passing efficiency). At least three games and 30 relevant attempts are
  needed; league ranks require every club to have a comparable sample. Balanced grades can give way
  to a small opening in the results, and conflicting film/results are called out. Faces identify unit
  leaders rather than promised one-on-one assignments.
- Opposition reports can explain an upcoming win that guarantees sole first by winning percentage in a
  late division matchup. Strong wins belong in the existing recap; its subject uses the opponent's record
  before that game. Injury reports point out a genuinely short position, and clearance subjects identify
  a full roster when it prevents a staff-managed return. Medical letters name the remaining available
  players, explain a shortage, identify supported cover/free-agent options, and explain IR when eligible.
  The availability card includes linked cover options marked with their natural position and "out of position".
  Old diagnosis cards explicitly distinguish the original report from the player's current health.

No hidden ratings, invented morale, rumors without simulation support, or claims of causation from
records alone. The existing categories, links and threading remain. Publications have no
private scouting knowledge and are never marked Needs you.

## Attention and history

`needsYou` means a present management task. Opponent briefings, ordinary injury notices and deadline
reminders do not qualify merely because they are current. `briefingCurrent` separately controls whether
matchup and deadline cards still show live information. Shortages, eligible IR activations, offers, draft
picks, scouting opportunities and existing contract/staff decisions keep their live checks.

The inbox still retains 300 entries, counting archived and deleted messages. Save format 36 adds the
optional `mailFloor`: an eviction date plus IDs removed on that date. Dates before the boundary cannot
return; unseen IDs on the same date can arrive. Only the boundary date's tombstones are retained, so the
ledger does not grow across seasons. A very busy single date can require more than 300 tombstones.

Save format 37 adds an optional rookie-report table snapshot to new letters. Rows retain their public
production and assessments when later games are played, players move, or box scores are pruned. Existing
narrative-only letters remain as originally filed; they are not silently regenerated.

Save format 38 adds optional SNN division and team-stat snapshots. Missing old statistics show a dash;
new games cannot rewrite a filed table.

Save format 39 adds optional trade-news snapshots so later pick pruning cannot change the reported price.

Save format 40 saves the optional supporting-table choice and trade-edition labels.

An older full inbox has already lost the identities of discarded entries. Its first delivery preserves
that date's conservative suppression, then records subsequent evictions precisely. This cannot recover
news already suppressed in the old save; it avoids resurrecting old deleted mail during upgrade.

## Review and validation

`src/engine/news.test.ts` covers public evidence, thresholds, ties, missing histories, incomplete weeks,
checkpoint delivery, traded rookies, snaps, long advances and save migration. The inbox tests cover
same-date arrivals after rollover, deleted-mail suppression and JSON reload. UI tests verify live
briefing cards independently of the attention badge.

Review an ordinary week, a busy medical week, the trade deadline, a division lead change, a rookie
checkpoint and a simulated finish. Check whether each subject is useful without opening it, its links
substantiate the story, and a second delivery produces no extra mail. A standalone feed, protected
unread retention, persistent narrative arcs and additional outlets remain outside this release.
