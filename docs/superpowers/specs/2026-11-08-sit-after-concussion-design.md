# Sitting a player after a concussion clears

## The problem

A concussed player takes his first protocol test in the week it happened, and about half of first concussions
clear there (`docs/INJURIES.md`, *Concussions*). The game, the test and the mail all land in one step, so:

- you never saw him in the protocol, so *Hold him a week after he clears* (only on his card while he's in it) was
  never on offer;
- AI clubs never hold anyone: a cleared man plays, whatever his file says.

For his first two games back a second concussion is twice as likely (`CONCUSSION_WINDOW`). A man can run three
concussions in three weeks with nobody choosing to sit him (a save's Taj Floyd: weeks 3, 4 and 5, then shut down for
the year). 0.4.18 gave this case its letter ("concussed, and cleared to play"); this gives it a choice.

## Your call: *Sit him this week*

On the doctor's "concussed, and cleared to play" letter, a button: **Sit him this week**. It puts him exactly where
the hold leaves a man: out for the next game, back the week after, so the first of his two risky weeks is spent on
the sideline. Pressed, it reads **Play him after all** and undoes it, until that week is played.

- Only for a concussion that cleared at its first test in the week just played (his file shows 0 games missed). A
  longer protocol already has the hold on his card while he's in it.
- Your call, always: your staff never sits a man for you (treatments work the same way).
- Mechanically the cleared man goes back to the held state `clearProtocol` leaves: `p.injury` a concussion, no
  protocol, a week left (`[1, 1]`); his file shows one game missed and `held`. `injuryWeek` lets him back the week
  after, as for any hold. Undoing it restores the all-clear (no injury, 0 games, not held).
- `sitProblem(league, p)` says why it isn't possible (not in season, not this week's all-clear, the week already
  played); the button shows only when it's possible or already pressed.

## AI clubs: one call at the all-clear

When an AI club's player clears the protocol (any week, not only the first test), the club decides once whether to
sit him a week. One draw on its own stream, `${seed}:${season}:${week}:sit:${playerId}`, so the draw shifts no
other roll (a man it sits still skips that week's practice field, as any injured man does).

The odds come mostly from his file, counted with this concussion:

| His file | Chance they sit him |
|---|---|
| First concussion in the past 12 months | 10% |
| Second this season, or two or more in the past 12 months | 60% |
| Third or more this season | 90% |

Then the stakes:

- **Pushes toward playing:** it's the playoffs, or he's a starter (a starting spot on the depth chart, `STARTERS`)
  for a GM at least as keen to win now as the one who pushes starters back from injuries (`AI_PUSH`, 0.6): × 0.5.
- **Pushes toward sitting:** he's a backup, so sitting him costs little: × 1.5.
- Never more than 95%.

Why mostly his file: real clubs nearly always play a man the independent consultant has cleared; they get careful
with repeat concussions. The first tier is kept low because the NFL's 59% who miss a game (the 33–50% band of
`concussions 0 games %` in `scripts/calibrate.ts`) already includes clubs' own caution. If `npm run sim` drops that
share below its band, trim the first tier; never move the band.

## The doctor's advice

Your doctor reads the same table as a doctor would: his file and his role, not the stakes (the GM's push is yours to
weigh). When that comes to 60% or more he says so on the letter: "I'd sit him this week: it's his second concussion
this season." Otherwise he says nothing more. The button is there either way.

## Mail

- No extra letter when you sit him: the injury letter skips a man whose all-clear (`cleared:` id) is already filed.
- No "cleared" letter when he's back from the sit: the all-clear is already filed under the same key.
- AI clubs' sits make no news.

## Tests

- `sitOdds`: the tiers by file, the playoff/win-now halving, the backup's 1.5×, the 95% cap.
- AI clubs: cleared men on AI clubs are held at about the table's odds (file shows 1 game, `held`, unavailable);
  your players are never held for you.
- `sitAfterClear`: sits and undoes; refused after the week is played, for a longer protocol, out of season.
- Mail: the letter's advice line follows the table; sitting him files no new letter; the button shows only while
  possible.
- `npm run sim -- 10`: `concussions 0 games %` inside 33–50.

## Files

`src/engine/injuries.ts` (`sitOdds`, the AI call in `clearProtocol`, `sitAfterClear`, `sitProblem`),
`src/engine/inbox.ts` (advice line, injury letter skip), `src/ui/mail.tsx` (the button), `docs/INJURIES.md`,
tests, changelog (0.4.20, re-landed after the cap-cut fix).
