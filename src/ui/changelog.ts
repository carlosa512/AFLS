/**
 * What each version added, newest first, for the version history behind the version tag. Every bump of
 * `package.json`'s version (`docs/VERSIONING.md`) adds its entry here: a title and one short paragraph a
 * player can read, about what changed for them rather than how.
 */
export interface ChangelogEntry {
  version: string;
  /** ISO date the version landed. */
  date: string;
  title: string;
  text: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.2.2',
    date: '2026-10-27',
    title: 'Real NFL builds',
    text:
      'New players now come in NFL shapes: most corners stand around six feet, with the odd 5\'8" one at one end and ' +
      'a 6\'3" one at the other, and every position follows its own curve. Players already in your league keep ' +
      'their builds.',
  },
  {
    version: '0.2.1',
    date: '2026-10-27',
    title: 'Where they came from',
    text:
      'Every player now has a school on his card and on the draft board. Most come from the big programs, but small ' +
      'schools turn up, mostly as undrafted free agents, and your scouts see less of them, so their ranges start ' +
      'wider. Each spring an International Pathway class joins the pool after the draft, with a practice squad place ' +
      'kept for one of them in new careers, and a few veterans come south from the Canadian league each offseason.',
  },
  {
    version: '0.2.0',
    date: '2026-10-26',
    title: 'Practice squads',
    text:
      'Every club now carries a practice squad of up to 16. Call players up for a game, sign them to the 53, or lose ' +
      'them to clubs that sign them away: your two best are protected each week. Cuts go on waivers, decided before ' +
      "each week's first kickoff. When your season ends, keep the squad players you like for next year. Your staff " +
      'run it all for you unless you take over, and existing careers can switch it on at their next offseason.',
  },
  {
    version: '0.1.20',
    date: '2026-10-26',
    title: 'The Arena Gazette does the numbers',
    text:
      'The Gazette now writes a numbers column every three weeks, plus a playoff preview and a season wrap: who ' +
      'leads the league in EPA per play, success rate, explosive plays and pressure, which quarterbacks add the most ' +
      'per dropback, who is climbing, and where your club stands. The game now counts these numbers on every play, ' +
      'without changing how a single one plays out.',
  },
  {
    version: '0.1.19',
    date: '2026-10-26',
    title: "Your director's recommendations",
    text:
      "The weekly market report is gone: SNN covers the league's trades. Instead your director of scouting writes " +
      'four times a year with two to four moves for us: three weeks before the deadline and in deadline week (add ' +
      'for a playoff push, sell when the season is slipping away, or one of each), when the league year opens and ' +
      'when free agency does. Each pick says why, what it might cost, and opens the trade table or free agency.',
  },
  {
    version: '0.1.18',
    date: '2026-10-26',
    title: 'A quieter offseason inbox',
    text:
      'When your deal is up, the owner offers you an extension instead of signing it for you: accept it, or turn ' +
      'it down and go into the GM job market. His new-year letter now carries his verdict, that offer and the ' +
      'budgets in one place. Firings, hires, extensions and hot seats around the league arrive as one SNN digest ' +
      'per offseason step, SNN and the Gazette have their own badges, and GM profiles say more about who is out of ' +
      'work, who has won what and who is under pressure.',
  },
  {
    version: '0.1.17',
    date: '2026-10-26',
    title: 'Interim coaches, tidied up',
    text:
      'A club without a GM still settles its interim head coach when the league year opens, so no team goes a ' +
      'season without a coordinator. Clubs no longer hold money back for a coordinator their interim is covering, ' +
      'a position move credits the interim running that side, and a late coaching change around the league is ' +
      'no longer lost when the weekly roundup has already gone out.',
  },
  {
    version: '0.1.16',
    date: '2026-10-26',
    title: 'Mail that tells you more',
    text:
      'A new job opens with a welcome from the owner (what he expects and what you can spend) and a rundown from ' +
      'your head coach: where the offense and defense rank, who they run through and which young players to watch. ' +
      'When a head coach is fired, the owner says why and what it cost, and a coordinator promoted to interim keeps ' +
      "running his side of the ball. Opposition reports are shorter, offers from other clubs show those clubs' " +
      'colours, firings around the league come as one weekly roundup, and your director says what each trade means for you.',
  },
  {
    version: '0.1.15',
    date: '2026-10-26',
    title: 'Choose who you are',
    text:
      'New Game now shows the GM you start as: change the name and pick a starting age from 30 to 45. Rename ' +
      'yourself any time with the pencil on your GM card, the same one player cards have.',
  },
  {
    version: '0.1.14',
    date: '2026-10-26',
    title: 'GM careers and owners who judge',
    text:
      'Every GM is a real person with a card, a portrait and a career record, and new GMs come up from scouting ' +
      'directors. Owners now judge you and your head coach on the results: a bad year costs patience, a run of ' +
      'them costs a job, in the offseason or after the trade deadline. If you are fired, you stay in the league, ' +
      'watch games and take the best offer that comes, usually from a club that needs rebuilding.',
  },
  {
    version: '0.1.13',
    date: '2026-10-26',
    title: 'A new front page and this history',
    text:
      'The start page has a new pitch for what the game has become, and every club shows its coaching, scouting ' +
      'and medical grades beside its roster overall. Those grades are now what you inherit: you take over the ' +
      "club's own staff instead of a fresh, average one. Click the version tag at any time to read this history.",
  },
  {
    version: '0.1.12',
    date: '2026-10-25',
    title: 'Coaches with habits',
    text:
      'Coaches carry habits that form and fade over a career and change real calls: going for two, playing ' +
      'prevent, scripted openings, disguised coverages, hard practices and more. Fourth downs follow NFL ' +
      'tendencies, rarer styles stand out, and recaps and staff reports say when a habit mattered.',
  },
  {
    version: '0.1.11',
    date: '2026-10-25',
    title: 'League news',
    text:
      'Sports News Network and the Arena Gazette report the league: division races, big turnarounds, major trades ' +
      'and rumors, each story with its table. Inbox reports keep to what matters to your club.',
  },
  {
    version: '0.1.10',
    date: '2026-10-22',
    title: 'A league that looks lived in',
    text:
      'The opening league now looks like one that has been running for years. Front offices keep sensible cap ' +
      'room, aging kickers and punters face a younger leg in camp, and rentals traded with salary kept are priced ' +
      'the way contenders and sellers actually price them.',
  },
  {
    version: '0.1.9',
    date: '2026-10-22',
    title: 'One set of screen rules',
    text:
      'Every screen follows the same rules for names, tables, tabs and team pickers, and a check now makes sure no ' +
      'screen shows a rating your scouts could not know.',
  },
  {
    version: '0.1.8',
    date: '2026-10-22',
    title: 'Team strength through your scouts',
    text:
      "Roster and Home show how strong a team is as your scouts read it, so a club you've barely watched is a " +
      "range, not a hard number. The start page alone shows each club's true overall, since you have no scouts yet.",
  },
  {
    version: '0.1.7',
    date: '2026-10-22',
    title: 'Tables sort the same way',
    text:
      'Standings, history, cap sheets, re-signings, the draft board and trade assets all sort by clicking a column, ' +
      'the same way everywhere. Trade views became tabs you can link to and come back to.',
  },
  {
    version: '0.1.6',
    date: '2026-10-22',
    title: 'A settled opening league',
    text:
      'New leagues open with contracts staggered like a real league: drafted players on rookie deals, re-signings ' +
      'charged their real cap hits, one kicker and one punter per club, and room kept for void years about to land.',
  },
  {
    version: '0.1.5',
    date: '2026-10-22',
    title: 'Names always link',
    text:
      'Every player and team name, on every screen and in every message, opens their card or roster, and every ' +
      'team dropdown is the same picker.',
  },
  {
    version: '0.1.4',
    date: '2026-10-21',
    title: 'Covering injuries',
    text:
      'When injuries leave a position short, coaches cover it from the roster first with a Play at move that ' +
      'survives auto-sort; AI clubs then sign at a fair price from the money they set aside for the season. Your ' +
      'own staff never signs or cuts for you: your inbox tells you who is covering, or links to free agency.',
  },
  {
    version: '0.1.3',
    date: '2026-10-21',
    title: 'No more cap hoarding',
    text:
      "Front offices plan an in-season cap reserve that fits their GM's style instead of sitting on huge piles of " +
      "room, and a buyer who can't reach his price for your player still bids what he can.",
  },
  {
    version: '0.1.2',
    date: '2026-10-21',
    title: 'Inbox fixes',
    text:
      '"See their offer" opens the offer, return-from-injury mail counts the weeks actually missed, team cities ' +
      'link, and opposition reports gained a key matchups card that pairs each unit with the one it faces.',
  },
  {
    version: '0.1.1',
    date: '2026-10-20',
    title: 'The red zone',
    text:
      'Near the goal line the field shrinks and the defense gets its call, so drives stall and finish the way they ' +
      'do in the NFL. Trade talks fold into one conversation in your inbox, and each offer says how it ended.',
  },
  {
    version: '0.1.0',
    date: '2026-10-20',
    title: 'Where the count starts',
    text:
      'The first numbered build: a full play-by-play match engine, scouting through the fog of war, coaching, ' +
      'scouting and medical staffs, trades with offers and physicals, injuries and the concussion protocol, ' +
      'position moves, an NFL-rule schedule with flex games, and an inbox that tells the story.',
  },
];
