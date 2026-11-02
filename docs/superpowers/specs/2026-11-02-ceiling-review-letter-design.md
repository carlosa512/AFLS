# The young players' review: one letter at season's end

## Problem

When a team's season ends, every young player's ceiling settles (`settleFinished` in `ceiling.ts`: rookies through
third-years). `ceilingMail` (`inbox.ts`) then files one letter per player whose ceiling read moved a point or more.
A Wild Card exit in a playtest save filed 13 at once: ten "X has hit a wall", three "X is outplaying his grades".

Three things are wrong:

1. **The flood.** Thirteen unread letters, one per player, bury the season's real mail (the futures letter, the
   wire).
2. **The wording.** "He's hit a wall. What you see now is about what you'll get" is final, and a rookie's ceiling
   has two more seasons to settle (`CEILING_SWING`). The letter should read against what we expected on draft
   day, the way a scout would put it.
3. **The stamp.** The letters carry `week: 0` outside the regular season, so the inbox files them under "Week 0",
   sorted below the Wild Card mail. Every other playoff letter carries `league.week`.

## What changes

`ceilingMail` is replaced by `ceilingReviewMail`: one letter a season from the scouting director, filed once our
season is over, with a table per verdict. The news is the same (our read before and after the settle), told once.

### When it files

- Once a season, when **our** season is over: the phase is `complete`, or it is `playoffs` and we have no unplayed
  game this season (the same test as `futuresWindowOpen`, without its personnel gate). In a playoff exit that is
  the week we lose, beside the futures letter.
- Only when the letter has something to say: at least one young player of ours moved a point, or a rookie of ours
  settled (so the "who we thought" table has rows).
- Not in a season that already has an old one-off letter (`ceiling:${season}:${playerId}` in the inbox). A save
  that got the old letters keeps them and gets no second telling.
- Id `ceilingReview:${season}`, so `mailSubject` reads it back as `{ kind: 'ceilingReview', season }`. The old
  `ceiling` kind stays in `mailSubject` for old saves.
- Stamped `phase: league.phase, week: league.week`. In `complete` the week is whatever the final left it at, as it
  is for the futures letter.

A player who joins after the letter files (a waiver claim during the playoffs) isn't added: his scout report
already says how his ceiling moved.

### Who is in it

Our players (`teamPlayers`, not retired) with `p.ceilingShifts[season]` set. For each, the move is our read before
and after, never the true shift, exactly as now:

```ts
const now = perceive(league, team.id, p).potMid;
const moved = now - perceive(league, team.id, { ...p, potential: p.potential - shift }).potMid;
```

- **Ahead of our grades:** `moved >= 1`.
- **Behind our grades:** `moved <= -1`.
- **Who we thought he was:** `|moved| < 1` **and** a rookie (`settleYear(p) === 0`, i.e. this was his first
  settle). Second- and third-years whose read held aren't listed: there is nothing new to say about them.

His year is his settle year (`settleYear`, read before the new league year ticks experience): 0 rookie, 1 second
year, 2 third year.

### The letter

- **From:** the director (`director(league)`), category `staff`.
- **Subject:** "How the young players' year went".
- **Body:** two sentences through `say` (`voice.ts`), keyed on the counts so it reads true for any mix, with no
  repeat of the director's last five letters. Two or three lines per case, for example:
  - ahead and behind: "With the season done, {n ahead} of our young players look better than we graded them and
    {n behind} are behind where we had them."
  - only behind: "With the season done, {n behind} of our young players are behind where we had them."
  - only ahead: "With the season done, {n ahead} of our young players look better than we graded them."
  - neither (rookies all held): "With the season done, the young players are tracking where we had them."
  - second sentence when rookies held: "The rest of this year's class is about who we thought."
  - second sentence when a rookie is behind: "It's early for the rookies: their ceilings have two more seasons to
    settle."
  Numbers as words ("three") through the existing `count` helper.
- **Sections** (`MailSection`), in this order, each only when it has rows:
  1. "Ahead of our grades"
  2. "Who we thought he was"
  3. "Behind our grades"
- **Columns:** Player · Pos · Age · Came in · Our read.
  - **Came in:** `"{draft season} R{round}, No. {pick}"` when he has a draft line, else `"Undrafted"`.
  - **Our read:** one line chosen by year and verdict (table below).
- Rows link to the player (`playerId`). Within a section: rookies first, then second-, then third-years; inside a
  year, the bigger move first; ties by id.
- **Actions:** the team (`{ kind: 'team', teamId }`). No player buttons: the rows link.
- Informational only: `needsYou` stays false.
- **covered:** the old per-player ids (`ceiling:${season}:${p.id}`) for every listed mover, so nothing can file the
  old way after it.

### Our read, by year

| Year | Ahead | Who we thought | Behind |
| --- | --- | --- | --- |
| Rookie | Playing above his draft grade. | Right on his draft grade. | Behind where we had him coming out. Still early. |
| 2nd year | More upside than we gave him credit for. | (not listed) | Hasn't taken the second-year step. |
| 3rd year | Still climbing past our projection. | (not listed) | Close to his ceiling: what you see is about what you get. |

The final-sounding line belongs to the third year only, the last settle. No rookie or second-year is called done.

Rookies are measured against "his draft grade" whether he was drafted or not: an undrafted rookie had a grade on
our board too. The cell lines are fixed per condition (no `say` rotation), so a table reads the same every time.

## Code

- `inbox.ts`
  - Replace `ceilingMail` with `ceilingReviewMail` (same slot in `deliverMail`).
  - Add a local `seasonOver(league, teamId)`: `complete`, or `playoffs` with no unplayed game for the team this
    season.
  - Add `{ kind: 'ceilingReview'; season: number }` to the `mailSubject` union and its `case`. Keep `ceiling`.
  - The body's lines are a `Line<…>[]` bank beside the function, like the other digests'.
- The letter body renders sections through the existing digest view (`ui/mail.tsx`); nothing new in the UI. If
  `ui/mail.tsx` has a card switch on `mailSubject` kinds, `ceilingReview` gets no card (the table is the content).
- No change to `League`'s shape: no `SAVE_VERSION` bump, no migration.
- `package.json` 0.2.45 → 0.2.46 (a fix, `docs/VERSIONING.md`). `docs/MVP.md`: no item moves.
- The draft-busts spec (`2026-10-27-draft-busts-design.md`, "Mail") gets a one-line pointer to this spec.

## Tests (`inbox.test.ts`, replacing the "ceiling mail" block)

Set up as now (`createLeague`, phase `playoffs`, shifts on young players of ours and of another club), with our
season over (no unplayed game of ours).

1. One letter for several movers: two of ours shifted up and down a point or more file one `ceilingReview:${season}`
   letter, from the director, with "Ahead of our grades" and "Behind our grades" rows for them, and nothing for
   the other club's player.
2. Files once: a second `deliverMail` adds nothing.
3. Not while we're still playing: with an unplayed playoff game of ours, nothing files.
4. Rookie wording: a rookie (experience 0) pushed down reads "Behind where we had him coming out. Still early.",
   and no rookie row anywhere contains "what you see is about what you get".
5. Third-year wording: a third-year (experience 2) pushed down reads the "Close to his ceiling" line.
6. Who we thought: a rookie with a shift under a point is listed under "Who we thought he was"; a second-year with
   the same shift isn't listed at all.
7. The stamp: the letter's `week` is `league.week`, not 0.
8. Old saves: with an old `ceiling:${season}:${id}` letter already in the inbox, no review files that season.
9. `mailSubject` reads the id back as `{ kind: 'ceilingReview', season }`.

Checks: `npm run typecheck`, `npx vitest run src/engine/inbox.test.ts` and, if it touches the mail view,
`src/ui/mail.test.tsx` and the screen contract in `src/ui/ui.test.ts`. No sims: the sim never reads the inbox.
