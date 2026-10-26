# Mail pass: firings, the trade desk, who's writing

Owner feedback from a 2026 save (screenshots, week 4–12): the owner's letter about our head coach being fired is the
same one line SNN prints; the interim coach was a coordinator and a new coordinator was hired from outside mid-season;
every firing around the league is its own email; SNN reports a trade and the director's market report repeats it the
next week; an offer from another club looks like mail from our own staff.

Five parts, built and shipped in this order (each its own commit, one PR):

1. An interim head coach keeps his coordinator job (engine fix)
2. The owner's letter when our head coach is let go
3. One weekly SNN roundup of coaching changes around the league
4. Mail from other clubs in their colours
5. SNN and the director stop repeating each other on trades

## 1. The interim keeps his coordinator job

**Today.** `installInterimHeadCoach` (`coaching.ts`) promotes the best coordinator to head coach, then runs
`fillChairs`, which fills the coordinator chair he left from the market (Scott Payne, "new hire", week 11). In the NFL an
interim promoted from coordinator nearly always keeps calling that side of the ball for the rest of the season.

**Change.**

- `Coach.actingAs?: 'offCoord' | 'defCoord'`: set on an interim promoted from a coordinator chair, naming the chair he
  still runs. Only an interim head coach carries it.
- One helper, `coordinatorOf(staff, role)`: the chair holder, else the head coach acting in that chair. Used wherever a
  coordinator is read: `teamScheme`, `callerStyle`, `coachingParts`' coordinator source (development) and the
  fit/vision lines on the coaches screen. His scheme already survives the promotion (`asPromoted` merges it), so the
  defense keeps its front and coverage instead of falling back to the base 4-3.
- `fillChairs` treats a chair covered by `actingAs` as filled, so nobody is hired into it mid-season. The head coach's
  chair itself, if no coordinator could be promoted, still fills from the market as now.
- `actingAs` ends where `interim` ends: `signCoach` in the staff window (made permanent: the chair opens and the
  normal offseason hiring fills it, with his vision), and `dismiss`. An interim from the market (no coordinator to
  promote) never gets `actingAs`.
- Coaches screen: the coordinator card shows the head coach with "Head coach, also running the defense" instead of
  an empty chair. No severance or salary change: he is paid as head coach for the rest of the season, as now.
- Save shape: one optional field. Bump `SAVE_VERSION` to 47; the `migrate.ts` step is a no-op for old saves (an interim
  who already had a coordinator hired keeps both; nothing to undo).

**Tests.** `coaching.test.ts`: a coordinator promoted in season leaves his chair empty with `actingAs` set; `teamScheme`
and `callerStyle` read his scheme and style; `fillChairs` hires nobody into that chair; signing him permanent in the
staff window clears `actingAs` and the chair fills. `npm run sim -- 10` and `npm run careers` (development reads the
coordinator), since play can move.

## 2. The owner's letter

**Today.** `leadershipWeek` writes one `report` string for a `coachInterim` event with no `privateText`, so
`leadershipMail` sends the owner's mail with the public line as subject and body.

**Change.** When the club is the user's, `leadershipWeek` stores a `privateText` letter (field already exists, no save
change), and `leadershipMail` uses an owner subject for inside mail: "I've let Lawrence Bennett go". Every sentence is
chosen by a condition on facts the sim already has, in the owner's voice (direct, short):

- **Why**, the record and its shape: "2–7, and four straight losses." Then whose fault, from the same talent rank
  `heatSoFar` uses: a roster in the top half of the league ("this roster is better than 2–7") vs the bottom half ("I
  know the roster is thin, but we went backwards"). A streak only when it's 3+.
- **Who's in charge now:** "Barry Allen takes over for the rest of the season and keeps running the defense." (the
  `actingAs` line from part 1; "comes in from outside" for a market interim).
- **What it means:** "Consider the next eight games his audition; you and I decide in the offseason whether he stays."
- **The bill:** "His severance is $5.58M, out of the coaching budget." and, when the budget is now over, "That puts us
  $1.52M over this year."
- Actions: Coaches, then GM careers and jobs.

The public `report` stays as it is for SNN and for other clubs.

**Tests.** `leadership.test.ts`: a forced in-season firing on the user's team produces inside mail with the owner
subject, the record, the interim's name and the severance; a losing streak under 3 isn't mentioned; another club's
firing still gets the public line.

## 3. One roundup of coaching changes

**Today.** Each other club's `coachInterim` / `gmDismissed` event is its own SNN mail.

**Change.** In `leadershipMail`, public in-season events (not ours) of the same week are gathered into one SNN mail,
id `leadership-week:{season}:{week}`, subject "Coaching changes: HOU, CIN" (or "Front-office change: …" for GMs only;
"Changes around the league: …" for both), one line per club in the body. A week with one change keeps a single-story
subject. Each event still counts as delivered (its own id is kept in `have`) so nothing doubles up across saves that
already have the single mails. Our own club's events stay separate, from the owner. Offseason events are unchanged.

**Tests.** Two other clubs firing coaches in the same week → one mail naming both; ours → its own owner mail; a save
that already filed one of them doesn't get it again.

## 4. Other clubs in their colours

**Today.** The avatar colour comes from the category (`cat-offer`), close to the director's `cat-trades` brown.

**Change.**

- `InboxMessage.fromTeamId?: number`: set by the senders that write as another club's front office (offers and
  enquiries, `inbox.ts` around lines 917 and 1031). Shares the part-1 save bump; `migrate.ts` backfills it by matching
  `from` against `${city} ${name} front office`.
- `Inbox.tsx`: a message with `fromTeamId` other than ours draws its avatar in that team's colours
  (`team.colors[0]` background, `colors[1]` ring), with the team abbreviation instead of initials ("BAL" not "BO"),
  a 3px left stripe on the list row in the same colour, and an "Other club" tag beside the category tag.
- Our own staff and SNN keep the category colours.

**Tests.** `ui.test.ts` screen contract: an offer from another club renders its abbreviation and the "Other club" tag;
a staff message doesn't. Migration test for the backfill.

## 5. SNN and the director on trades

**Today.** SNN runs a trade story in its fortnightly edition (week 4, "Weeks 3–4"); the director's weekly report (week
5) lists the same trade in one line, so the second email says nothing new.

**Change.** Each sender gets a job:

- **SNN**, the story: selection stays as `docs/NEWS.md` sets it. Its article gets one more sentence of context, chosen
  by condition: the seller's record ("The Squall, 1–3, are selling.") and, with retained salary, why the buyer could
  afford it.
- **The director**, what it means for us: each trade line in the market report gets at most one note, the first of:
  - a division rival bought: "A division rival got stronger at LB."
  - it sets a price for one of ours at the same position whom a club has asked about or who is on our block: "A
    marker for what Mendiola could fetch."
  - we play the seller or buyer in the next three weeks: "We see Seattle in week 7, without him."
  - none of these: no note.
- When SNN already ran the trade, the director's line says "(SNN ran the story)" and the report's opening counts it
  as reported, not new: "The Outlaws' deal SNN covered is the only trade; what it means for us is below."

**Tests.** `inbox.test.ts`: a rival trade gets the rival note; a trade with no angle gets none; an SNN-covered trade is
marked. `news.test.ts`: the seller-record sentence appears.

## Out of scope

- How often coaches are fired, and offseason hiring: unchanged.
- Other mail types' wording.

## Release

Per `docs/VERSIONING.md` these are fixes and polish on the done inbox item: bump the last number of `package.json`'s
version once, in the last commit. `docs/NEWS.md` gets the roundup and the director's notes. `npm run typecheck`, the
touched tests, and for part 1 `npm run sim -- 10` and `npm run careers`; then CI on the PR.
