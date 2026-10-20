# AFLS

A deep American football management simulation: run a franchise in a fictional 32-team league,
build the roster and the staff, and watch every snap play out from real player-vs-player matchups.
Everything your front office knows is what its scouts have seen, so the game lives in the gap
between what you believe and what is true.

![A week in the front office: the home screen, then the roster and depth chart](docs/media/demo.gif)

<table>
  <tr>
    <td width="50%"><img src="docs/media/home.png" alt="Home at week 7: division standings, injuries, inbox, league leaders and team stats"><br><sub><b>Home.</b> Standings, injuries, what the inbox needs from you, league leaders and team stats.</sub></td>
    <td width="50%"><img src="docs/media/coaches.png" alt="Coaches: the quarterbacks room opened to show who counts for growth and decline"><br><sub><b>Coaches.</b> Open a room to see who counts for its players' growth and decline, and by how much.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/player-card.png" alt="A player card in 2026: scout's report, habits, health and the ratings behind his overall"><br><sub><b>A player, year one.</b> The scout's report, his habits, his health, and the ratings behind his overall.</sub></td>
    <td width="50%"><img src="docs/media/player-card-four-years-on.png" alt="The same player four seasons later: rating arrows, his development curve from 15.1 to 16.5, and his veteran deal"><br><sub><b>The same player, four seasons on.</b> Arrows since last year, his development curve, and the deal he earned.</sub></td>
  </tr>
</table>

## Play

```bash
npm install
npm run dev        # open the printed local URL
```

The game runs in your browser and saves there. It is not hosted anywhere yet.

## Develop

Start with `npm run check`. It reads what you changed, runs the checks that change calls for side
by side, and prints one line each. CI runs the same plan on every pull request, so a red line here
is a red check there.

```bash
npm run check            # the checks your change needs; --quick skips the slow ones, --all runs everything
npm run typecheck        # tsc, no emit
npm test                 # engine and UI tests (vitest); npm run test:watch keeps them running
npm run build            # production web build in dist/
npm run build:single     # one self-contained page at dist-single/afls.html, for sharing
npm run preview          # serve the production build locally

npm run sim -- 10        # simulate seasons and compare league stats, leaders and injury rates to the NFL's
npm run endings          # audit thousands of game endings for clock-management nonsense
npm run offseason -- 6   # run seasons back to back: cap health, rosters, talent and the staff economies
npm run audit            # raise each rating in turn and check it moves play; rewrites docs/ATTRIBUTES.md
npm run careers          # age a draft class: peaks, declines, retirements, trait and coaching effects
npm run quirks           # the on-field habit bag: how often habits are carried, gained and lost
npm run weather          # roll seasons of weather and check it looks like the NFL's
npm run crews            # officiating crews: flags per game, busiest against quietest, the rotation
npm run trades           # the trade market against NFL prices, every AI deal read as it closes
npm run training         # position moves and development released in steps
```

See [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) for the vision, how the engine works and the
roadmap, and [`CLAUDE.md`](CLAUDE.md) for the working notes on the codebase.
