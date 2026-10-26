# Offseason mail diet, your contract offer, GM perception

Owner feedback from a 2027–2030 save (screenshots of the inbox and the GM screen): the re-sign window buries the inbox
in one SNN email per GM extension, firing, hire and hot-seat rumour; the owner sends his budget letter, then separate
mails that repeat the public line about our own GM ("League sources suggest DEN GM Todd Brown could be entering a
prove-it season."); our GM is extended without being asked; SNN's avatar reads "SD"; a fired GM and three different
champions all read the same on the GM screen.

This is piece A + B of a four-part mail pass. C (the director's recommendations replace the market report) and D (the
Arena Gazette as an analytics column) get their own specs.

Five parts, one PR, each its own commit, in this order:

1. Your contract: an extension offer you accept or decline
2. One owner letter per league year
3. One SNN carousel digest per offseason step
4. Senders and avatars
5. GM public perception

## 1. Your contract: an offer you answer

**Today.** In `leadershipNewYear` (`leadership.ts`), a GM whose deal has run out (`a.through < l.season`) and who
survives the review is extended in place: two years, or to this season on a warning, plus a public `gmExtended` event.
The user's GM goes through the same branch, so the user is extended silently and learns it from a public line.

**Change.**

- For the user's GM only, the branch does not touch `a.through` and files no event.
- `beginGmSearch` (called at the end of `leadershipNewYear`) makes the offer: when the user holds a permanent job at
  our club whose `through < l.season`, it puts first in `search.offers` a `GmJobOffer` with `teamId` = our club,
  `through` = what the owner would have given (`l.season` when our review's outcome is `warning`, the one-year prove-it
  deal; `l.season + 2` otherwise), `incumbent: true`, and a new optional `extension: true`. The search starts at round
  0 whenever offers exist, as now.
- `pendingGmOffers` already blocks the calendar (`offseasonBlockers`, `advanceOffseason`) while an offer is open, so
  the user must answer before free agency. The blocker text gets an extension variant: "Answer the owner's extension
  offer before leaving the staffing window."
- **Accept** (`acceptGmOffer`): an `extension` offer sets the current appointment's `through` to the offer's (a new
  `extendGm(league, gmId, through)` in `gm.ts`, the extension twin of `makeGmPermanent`), records the terms, and files
  the public `gmExtended` event as AI extensions do. Nothing else about the job changes (no scouting reset).
- **Decline** (`declineGmOffers` with an extension offer open): the appointment ends (`endGmAppointment(…,
  'expired')`, the deal ran out and he walked), our club joins the vacancies, and the user goes into the pool exactly
  as a GM without a job does: the guaranteed offer and `additionalOffers` (factor the `user.teamId === null` block of
  `beginGmSearch` into `userJobOffers(l)` and call it from both). `justLeft` already keeps our old club off the list.
  `playerDeclined` is not set, so offers can still arrive in later rounds. If the user then declines those too, it
  works as today (sits out).
- Expiry: the extension offer expires at round 3 like any offer, which cannot happen while it blocks the calendar.
- Sim offseason (`autoUser`) accepts it, as `advanceGmHiringRound` already accepts `offers[0]`; the extension offer is
  put first.
- The GM screen's offers card (`GmEmployment.tsx`) shows an extension offer as "Extension through 2031" with Accept /
  Decline and enter the job market; the decline button's confirm text says the job ends.
- AI GMs: unchanged.

**Save.** `GmJobOffer.extension?: boolean`. Bump `SAVE_VERSION` to 50, with a no-op `migrate.ts` step (an older save
mid-window has no extension offer; its GM was already extended).

## 2. One owner letter per league year

**Today.** `ownerMail` sends "A letter from the owner" (budgets). `leadershipMail` separately sends our club's
`warning`, `coachChange` and `gmExtended` events "from the owner" with the public line as subject and body.

**Change.**

- `ownerMail` writes the one letter of the league year: subject by the review's outcome, chosen by condition:
  - extension offer open: "Your contract: an offer through 2031"
  - warning: "The new league year: I expect progress"
  - coach change required: "The new league year: we need a new head coach"
  - otherwise: "The new league year" (replaces "A letter from the owner").
- Body, in order, each sentence only when it applies: the verdict (`leadershipReview.reason`, which is private
  already); the contract ("Your deal is up. I'd like you back through 2031; let me know." / the prove-it version "One
  more year, through 2028, and we'll talk again."); then the existing budget line, leeway, patience and coach
  promises. Cards: the existing budget card. Actions: GM careers and jobs when an offer is open (Needs you, through
  `needsYou` reading `pendingGmOffers`), then Coaches, Cap sheet.
- `leadershipMail` skips our own club's offseason `warning`, `coachChange` and `gmExtended` events: their id still goes
  into `have` (filed as delivered, no mail) so the letter isn't followed by stragglers. A firing of our GM or head coach
  stays its own owner mail (a different moment), as does the welcome letter for a new GM.
- The existing "permanent GM offer" / "GM job offer" mails stay for interim and job-pool offers; an extension offer
  does not get one (the owner's letter is that mail).

## 3. One SNN carousel digest per offseason step

**Today.** The in-season roundup gathers other clubs' leadership events by week. Offseason events skip it, so each
is its own SNN mail (dozens per re-sign window). "Coaching carousel: 6 new head coaches" comes from League office.

**Change.**

- `leadershipMail` gathers other clubs' offseason events by `(season, phase)` the way it gathers in-season ones by
  week, with the same id range scheme: `leadership-phase:{season}:{phase}:{first}-{last}`, so an event that arrives
  after the digest is filed starts a new one. Each event's own id is treated as covered, so a save that already filed
  single mails gets nothing twice.
- Subject counts what matters, in order, up to three parts: "Front-office carousel: 4 GMs out, 3 hired, 6 on the hot
  seat". A phase with one event keeps that event's line as the subject.
- Body: one lead sentence ("Four clubs changed general managers this offseason; six more GMs start the year under
  pressure.") and a table card, grouped Out / Hired / Extended / Hot seat, one row per event: club badge, GM (link),
  the line (record for firings, "through 2031" for extensions, "pressure to change the coaching staff" / "prove-it
  season" for hot seats). Saved with the mail as a snapshot like the SNN tables (`docs/NEWS.md`), so later events
  can't rewrite it.
- The coaching carousel mail (`inbox.ts`, "Coaching carousel") keeps its table and moves to `from: 'SNN league desk'`.
- Interim head-coach calls (`coachPermanent`, `coachDismissed`) go into the same digest under "Coaches".

## 4. Senders and avatars

- League office keeps official notices about our club: our players' awards, our schedule flexes, our clinches, our
  trade confirmations. League-wide stories (the coaching carousel) are SNN's.
- `SenderAvatar` gets fixed badges for outlets instead of initials from the sender name: "SNN league desk" → **SNN**,
  "The Arena Gazette" → **GAZ**, "League office" → **LO**, "The owner" → **OWN**. One map, `OUTLET_BADGES`, in
  `Inbox.tsx`; people keep their initials, other clubs keep their abbreviation.
- `ui.test.ts` contract: every `from` the engine writes that isn't a person renders a badge from the map (no "SD").

## 5. GM public perception

**Today.** `gmStyleNotes` (`ui/gm.tsx`) returns one line from six fixed ones; every champion reads the same and a
fired GM reads "Still building a public track record".

**Change.** One or two lines, each chosen by a condition on public facts (`gmRecord` seasons, appointments and their
end reasons, public leadership events). The first that applies leads:

- Between jobs (no current appointment):
  - fired: "Out of work since LV let him go after a 3–13 season."
  - deal ran out: "Left SF when his deal ran out after 2027; available."
  - out more than a year: "Hasn't run a front office since 2027."
- Titles:
  - two or more within any three seasons: "Two titles in three years."
  - a title, then losing seasons since: "Won it all in 2026; 9–25 since."
  - otherwise one title: "A title in 2026 on the résumé."
- Deep runs: three straight playoff trips, or a title-game loss: "One win from a title in 2027." / "Three straight
  playoff trips."
- On the hot seat (a public `warning` or `coachChange` event this league year): "Starts 2030 under pressure from
  ownership."
- The existing lines for a losing record, a first playoff trip, a former director, and the fallback.

Second line, only when it adds something: the best season ("Best year: 15–2 in 2028.") or tenure ("In his fifth year
in Miami."). Pronouns follow the GM (`pron`). The user's own GM keeps the current two lines.

## Testing

- `leadership.test.ts`: the user's expiring GM gets an extension offer and is not extended; the calendar is blocked;
  accept extends `through` and files `gmExtended`; decline ends the job, our club becomes a vacancy, offers arrive and
  exclude our old club; `autoUser` accepts; a warning gives a one-year offer; an AI GM is still extended in place.
- `inbox.test.ts`: one owner letter with the offer and Needs you; no separate owner mails for our warning or extension;
  other clubs' offseason events make one SNN digest per phase; a save that already filed single mails gets no
  duplicates; a late event starts a new digest; the carousel is from SNN.
- `ui.test.ts` / `mail.test.tsx`: outlet badges.
- `gm.test.tsx`: each perception case, and at most two lines.
- Migration test for v50.
- `npm run typecheck` and the touched tests. No sims: nothing here changes play.

## Release

Fixes and polish on the done inbox item: bump `package.json` from 0.1.17 to 0.1.18 in the last commit
(`docs/VERSIONING.md`). `docs/NEWS.md` gets the digest, the owner's letter and the extension offer.

## Out of scope

- How often GMs are fired or extended; the AI's offseason.
- C (director's recommendations) and D (the Gazette): separate specs.
