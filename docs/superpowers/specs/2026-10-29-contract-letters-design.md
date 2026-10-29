# Contract letters you can act on

Date: 2026-10-29 · Branch: `claude/clever-bell-3tr3fx` · Chunk C of the owner's mail notes (Oct 28, 2026)

## Why

When the re-sign window opens, the inbox gets a stack of agents' letters folded under "14 contracts are up". Each
opens to a card with last season's games and the opening ask, and the only way to act is the Expiring contracts
button, which leaves the inbox for the Re-sign screen. The owner called the list-and-breakdown awkward. The staff
contracts letter already lets you extend each coach, scout and medic in place while the window is open, but you can't
let anyone go from it, and nobody says whether a man is worth his ask.

The goal: one letter per window for the players and one for the staff, each with a row per person, the staff's call
on him, and the buttons to act on that call right there. The Re-sign screen stays for the deep look.

Chunk A (digests, `voice.ts`, `MailSection`) is merged; this builds on it.

## Decisions (agreed with the owner)

1. **Rows show the staff's call and quick actions.** For players: Sign at ask, Tag, Let walk, and Negotiate, which
   opens the Re-sign screen's talks dialog over the inbox. For staff: Extend and Let go.
2. **The call for players is the AI clubs' own re-sign rule,** pulled out of `aiResignWindow` into one function both
   use, so our staff and every other front office decide the same way.
3. **Let walk is a choice you make and can undo,** stored on the team for the window; it stops the letter asking.
4. **The Re-sign screen and negotiation are unchanged** (except that a player you're letting walk says so).
5. **Old saves keep their letters.** The folded agents' letters already filed stay as they are.

## The players' letter

### What it is

From the director of scouting (`director` in `senders.ts`), category `contracts`, id `expiring:{season}`, filed
once as the re-sign window opens. `covered` lists the old per-player ids (`contracts:{season}:{playerId}`) for every
row, and `newYearMail` stops filing the per-player agents' letters (old saves keep the ones they have; `mailSubject`
still reads them).

Subject: "Contracts up: N players, our calls". Body: one opener through `say` (director's voice, analytical and
hedged), e.g. "Fourteen deals are up. My calls below; the money is each agent's opening ask."

### The rows

One section, "Expiring contracts", a row per expiring player (`expiringPlayers`), sorted Keep first, then Tag, then
Let walk, and by our read within each. Each row:

- **Player** (`PlayerLink`), **age**, **our read** (his overall as our staff sees it; own players' visible ratings
  are exact), **his ask** (APY × years, guaranteed share, from `demand`), **the market** (`demand(...).market`).
- **The call:** Keep, Tag or Let walk, with a note in the director's words saying why, chosen through `say` from a
  bank keyed on the call's reason (below). Examples: "Starter at a thin spot, and he's still climbing." "He's fading,
  and Ruiz is already better." "Young enough that the ceiling is the point." "Top-of-market money for a top-of-market
  player. Tag him if talks stall."
- **What happened**, once you've acted: "Re-signed thru 2031", "Tagged", "Letting him walk", "Talks broken off".

### The call

`resignCall(league, teamId, p): { call: 'keep' | 'tag' | 'walk'; reason: ResignReason }` in `offseason/ai.ts`,
extracted from `aiResignWindow` without changing what it decides:

- **keep** when he's a keeper by today's rule: his outlook (`teamOutlook`) clears the starter bar at his position
  less half a point, or he's 25 or under with a projected ceiling of 12+, or the room is under its keep minimum
  (`KEEP_MIN`); and he isn't past the age line (`ageShift`). `reason`: `starter`, `young` or `depth`.
- **tag** when he's a keeper, in the top quarter of his position's pay (`payTier ≥ 0.75`), young enough for the AI's
  tag (`age − ageShift ≤ 30`), and the tag is open to us (`tagBlocker` is null). This is the AI's tag condition
  without its coin flip: we say when a tag is the right tool, and you decide.
- **walk** otherwise. `reason`: `fading` (his outlook is under the starter bar and falling), `age`, or `backup` (the
  room is covered without him).

`aiResignWindow` calls `resignCall` for its keeper test and keeps its own random draws (tests-the-market, the tag's
coin flip) in the same order, so AI re-signs come out identical on the same seed. A test pins that.

### The buttons

Each row's buttons call what the Re-sign screen already calls; nothing new in the engine but the walk list:

- **Sign at ask:** `makeOffer` with `askOffer(demand(...))`. It signs when the offer fits; otherwise it's disabled
  with `offerProblem`'s reason (the cap, the roster). Talks broken off this window: disabled, "Talks broken off".
- **Tag (amount):** `applyFranchiseTag`; disabled with `tagBlocker`'s reason.
- **Let walk / Keep talking:** toggles him on the team's walk list (below).
- **Negotiate:** opens `NegotiationDialog` over the inbox, the same one the Re-sign screen opens.

The buttons show only while the window is open and he's still unsigned; after that, the row shows what happened.

### Needs you

The letter needs you while any expiring player has no decision: not re-signed, not tagged, not on the walk list,
and talks not broken off. `needsYou` works it out from the league as it is (nothing stored beyond the walk list).

## Let walk

`Team.lettingWalk?: { season: number; ids: number[] }`: who you've decided to let go this window. It changes nothing
in the engine: a player you don't re-sign walks when free agency opens, as now. It only records the decision, so the
letter stops asking and the Re-sign screen can show "Letting him walk" on his row. It's kept with its league year, so last year's list reads as empty and nothing has to clear it.
`setLettingWalk(league, playerId, on)` in `offseason/index.ts` is the one writer. `SAVE_VERSION` 65 → 66 with a no-op
step (the field is optional).

## The staff letter

The existing staff contracts letter (`staffDealsMail`, `StaffDealsCards`) keeps its shape and gains:

- **Let go** beside **Extend** while the window is open: `releaseCoach`, `releaseStaff` or `releaseMedic`, the same
  calls the Coaches, Staff and Medical screens make. Letting the head coach go asks to confirm first.
- **A one-line call per person:** "Worth the raise", "Fair price for what he gives us", "Over the budget at his ask",
  or "We can do better for the money", read off his ratings against the league's others in his chair (above or
  below the middle) and his ask against his current salary and our budget (`moveOverspend`, the budget forecasts the
  letter already reads). Through `say`, in the front office's voice.

Nothing else about the staff letter changes: who's listed, the outlook tags ("Re-signs", "Leaves: budget"), the
Extend checks.

## UI

- The players' letter uses `MailSections` with a row type that carries actions. `MailSection` rows gain an optional
  `contract?: { playerId: number }` (like `claim` for the waiver wire): the component draws the call, the note, and the
  four buttons from the league as it is now, so a filed letter stays live.
- `NegotiationDialog` opens from the inbox: the inbox screen holds the open player and renders the dialog, as
  `FrontOffice` does.
- The Re-sign screen shows "Letting him walk" on a walk-listed row, with Keep talking to undo.
- `docs/UI.md` rules apply; the screen-contract tests cover the new parts.

## Files

| File | Change |
| --- | --- |
| `src/engine/offseason/ai.ts` | `resignCall`, `ResignReason`; `aiResignWindow` uses it |
| `src/engine/offseason/index.ts` | `setLettingWalk`; the walk list clears when the window closes |
| `src/engine/contractMail.ts` | new: the players' letter (rows, calls, notes, `needsYou`) |
| `src/engine/inbox.ts` | call the new letter; `newYearMail`'s per-player agents' letters stop; `mailSubject` (`expiring:`), `needsYou`, `KIND_TAGS` |
| `src/engine/types.ts` | `Team.lettingWalk`; `MailSection` row `contract` |
| `src/engine/generate.ts`, `migrate.ts` | `SAVE_VERSION` 66 and its step |
| `src/ui/mail.tsx` | contract rows and their buttons; Let go and the call line on staff rows |
| `src/ui/screens/Inbox.tsx` | hosts `NegotiationDialog` |
| `src/ui/screens/FrontOffice.tsx` | "Letting him walk" on the Re-sign table |
| `src/ui/App.tsx` | the draft's main button opens the draft room; Auto-draft… with a confirm |
| `src/ui/screens/Draft.tsx` | Sim the rest asks first |

## Testing

`npm run typecheck` and the touched tests. Because `aiResignWindow` changes shape, also `npm run offseason -- 6`
(it reads AI re-signing) at a small size before pushing; CI runs the rest.

- **Same decisions:** on a seeded league, `aiResignWindow` signs and tags the same players as before the extraction.
- **The call:** a starter at a thin spot is Keep; a fading veteran behind a better starter is Walk; a top-quarter
  keeper with the tag open is Tag; a used tag turns that into Keep.
- **One letter, once:** the window files one players' letter, re-delivery files nothing, and no per-player agents'
  letters.
- **Buttons do what the Re-sign screen does:** Sign at ask signs at the ask (and is disabled with the reason over the
  cap); Tag tags; Let walk toggles the list; Negotiate opens the dialog.
- **Needs you** clears once every row has a decision.
- **Staff:** Let go releases the person; the head coach asks first; each row has a call line.
- **No leaks:** no hidden trait or true rating in the letter's text; `BANNED` as in chunk A.
- **Old saves:** a v65 save loads; its folded agents' letters still open.

Screenshots of both letters, desktop and phone, go to the owner before the PR.

## The draft: no auto-picks by accident

Asked for alongside this chunk (owner, Oct 29). During the draft, the top bar's main button reads "Finish the draft"
and one click sims every remaining pick, ours included, with no warning (`offseasonStep` in `ui/App.tsx` runs
`advanceOffseason`). The draft room's "Sim the rest (AI picks for you)" does the same with no warning either.

- **The main button while picks remain** reads **Go to the draft** and only opens the draft room: no pick is made, the
  phase doesn't move. Once the draft is complete it reads "Start training camp", as now.
- **Auto-draft asks first.** While picks remain, the top bar's second button is **Auto-draft…**, a `SimAction` with
  the same confirm dialog the other sims use: "Let the AI make the rest of the picks? The AI makes every remaining
  pick, yours included. This can't be undone." Confirming runs `draftToEnd` and opens the draft room on the results.
  (When the draft is complete, the second button is "Sim offseason…" again.)
- **The draft room's "Sim the rest"** opens the same confirmation before it runs.
- **Unchanged:** Sim to my pick, Next pick, and Auto-pick for me (one pick, the one on the clock, when you click it).

Test: with picks remaining, the main button's step makes no pick and leaves the phase as `draft`; the auto-draft
action is a `SimAction` with a confirm; the draft room's Sim the rest renders a confirm before `draftToEnd`.

## Out of scope

- Players asking for extensions, hold-ins and holdouts (chunk G).
- Changing how asks, negotiation or the tag work.
