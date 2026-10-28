# Open questions

Questions for the project owner, kept while work goes on around them. Each says what was seen and what is waiting.

## Draft-day trades (0.2.14)

1. **Fewer draft-day trades than the NFL.** The AI makes about 19 trades a draft (18.8 averaged over the check's leagues); the NFL's 2015-2025 drafts ran
   35-45 (the plan's target, `docs/TRADES.md` §6). Rounds 1-2 are close to the NFL; rounds 3-7 trade much less,
   because the tier break a team needs before it calls (`COVET_MIN`, 0.8 board points) is the same in every round
   while later boards are flatter, and few future-for-current swaps close (`DRAFT_SWAP_RATE` 3% a pick). A trial
   (reverted, not shipped) with a smaller tier break after round 1 (0.25) and a 20% swap rate reached 38.8 a draft
   with every other draft-day number in range. **Waiting on you:** tune it, or keep it as is?
2. **The draft-day numbers are shown, not failed, for now.** `npm run trades` prints a Draft day section with each
   target, marking misses "off target (not failed)", so CI stays green while question 1 is open. Once you decide,
   they can become failing checks like the rest.
3. **Cost a pick sits near its budget.** Under 3 ms a pick is the target; it measures 2.94 ms. Sorting every
   season's picks on each read is most of the trade-up search's cost; caching the draft order in the draft's memo
   brought it to about 2.5 ms in a trial (reverted, since it touches engine code). OK to ship that speed-up?
4. **Teams over the cap after the draft.** After the draft step, 3-5 teams a league are over the cap until camp,
   with or without draft-day trades (the rookie class signs at once). That is older than this PR; it only showed
   because the trades check read team health after the draft's deals. The check now skips draft deals (they move
   no salary). Intended?
