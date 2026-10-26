# News cycle

The inbox remains a manager's desk: personal letters carry management decisions, and occasional public
reporting explains the league. Delivery still happens after `store.mutate`; the simulation never sends mail.

## Editorial rules

- SNN — Sports News Network reports late division-lead changes in the user's division. It uses the same
  standings and tiebreakers as the standings screen and never turns provisional first place into a clinch.
- The Arena Gazette reports substantial reversals from last season. At 8, 12 or 17 team games, a club
  with at most six wins last year qualifies at a .750 winning percentage; a club with at least ten wins
  qualifies at .375 or below. Division relevance comes first, then the largest percentage change, then
  team ID for a deterministic tie. These are editorial thresholds, not simulation effects.
- Features add a meaningful year-over-year change in scoring per game, points allowed per game, passing yards per game or
  third-down conversion rate. Per-game and rate comparisons account for different season lengths. Ranks
  require league-wide samples (six games now, eight last year); missing prior box scores never become zeros.
  Defensive declines are described as lost ground (or a collapse for a substantial deterioration), rather
  than presenting higher points allowed as an improvement. Division stories locate your team in the race and can report a losing streak or an ended winning streak.
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
- SNN tells a trade's story; the director of scouting's market report says what it means for us, one note per
  trade at most, the first that applies: a division rival bought; it prices one of ours at the position (on our
  block, or in an offer made to us); we play the seller or the buyer within three weeks. A trade SNN already ran is
  marked "(SNN ran the story)" and the report's opening says so, rather than retelling it.
- Other clubs' in-season coaching and front-office changes reach the inbox as one SNN roundup per week ("Coaching
  changes: HOU, CIN"); a lone change stays its own story, and our own club's come from the owner.
- One public headline at most is selected for the latest fully completed regular-season week. There is
  no minimum quota. Division stories take precedence, then key trades, trajectory features and public rumors.
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
