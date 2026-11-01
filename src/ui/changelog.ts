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
    version: '0.2.32',
    date: '2026-11-01',
    title: 'Better-drawn players',
    text:
      'Player pictures have new arms: they hang straight instead of bowing out, with more muscle the heavier the ' +
      'player. The picture is framed a little wider, the jersey runs down to football pants at the hips, white at ' +
      'home and in the team colour with the white jersey, striped down the side. Receivers and corners no longer ' +
      'look pinched at the waist, and on the player card a short player looks compact and a tall one rangy, at the ' +
      'same weight.',
  },
  {
    version: '0.2.31',
    date: '2026-11-01',
    title: 'Flags, injuries and the final whistle',
    text:
      'All-22 now has officials on the field for every snap: the nearest one throws the flag when there is a foul, ' +
      'play stops while the crew confers, and the call goes up on a banner. A flag that wipes out a play shows the ' +
      'play first. When a player is hurt, play stops: the others back off, the trainers run out, and he walks off, is ' +
      'helped off or is carted off. A game won on its last play brings the whole sideline onto the field while the ' +
      'losers walk off; a title ends in confetti. Each field now looks like its stadium: grass or turf, end zones in ' +
      "the teams' colors, yard numbers and goalposts. Field goal results wait until you have seen the kick, and " +
      'All-22 now plays at up to 4×.',
  },
  {
    version: '0.2.30',
    date: '2026-10-31',
    title: 'Watch from above',
    text:
      'Replays and live games have a new All-22 view: the play from above, all 22 players as numbered dots in their ' +
      'kits. The line blocks, receivers run their routes, the back blocks or leaks out, the defense reads and pursues, ' +
      'and the tackler plays his part, then runs the carrier down (on a long return he can miss and come again). Kicks ' +
      "are staged with real formations: field goals, punts, and kickoffs under today's rules. After the whistle an " +
      'official walks the ball to the spot, both sides huddle, everyone jogs to his spot in his own time, subs come ' +
      'and go, the units change over before a kickoff with the officials out, and a big play gets a short ' +
      'celebration. The players a play is about are ringed only as their moment comes, and in both views the result ' +
      'and the score wait until you have seen the play. Tap a dot to see who it is. On a phone held upright the field ' +
      'runs up the screen and follows the ball. Switch between Broadcast and All-22 beside the highlights; All-22 ' +
      'plays at 1× or 2×.',
  },
  {
    version: '0.2.29',
    date: '2026-10-31',
    title: 'Every snap is on file',
    text:
      'Games you play from now on remember who was on the field and who each play was about: the passer, the target, ' +
      'the man in coverage, the tackler, the rusher who got home. Nothing changes on screen yet, and no result moves. ' +
      'It is what the coming top-down All-22 view will show. Games played before this keep their replays as they are.',
  },
  {
    version: '0.2.28',
    date: '2026-10-31',
    title: 'Watch the highlights',
    text:
      'Replays and live games now have Key, Ext and Full beside the speed button. Key shows the plays that decide a ' +
      'game: scores, turnovers, big gains, fourth downs and a close finish. Ext adds third downs, goal-line snaps, ' +
      'sacks and the drive before half. The plays in between still land in the log and on the scoreboard, so you ' +
      'never miss a result. Your pick is remembered on this device.',
  },
  {
    version: '0.2.27',
    date: '2026-10-31',
    title: 'Every body is different',
    text:
      'Players now look like their builds. A slot receiver is lean, a lineman is big and wide, and a corner who weighs ' +
      'like a safety looks like one. Each player has one of three head shapes for life, and on his card a tall player ' +
      'for his position stands a little taller and a short one a little lower. List icons stay as they were.',
  },
  {
    version: '0.2.26',
    date: '2026-10-30',
    title: 'Being heard',
    text:
      'When you promise a player a new deal or more snaps, he now eases off while he waits for it, and a reassurance ' +
      'calms him for a while too; his reason reads “Waiting on his new deal” instead. Words alone still don’t fix a ' +
      'pay complaint. When the season ends, the head coach sends a reminder of every promise you still owe.',
  },
  {
    version: '0.2.25',
    date: '2026-10-30',
    title: 'Coaches with character',
    text:
      'Coaches now have ambition, loyalty, adaptability and discipline. Some chase a head coach’s job the first chance ' +
      'they get and some are happy where they are; a fired head coach may go back to running a side of the ball. Clubs ' +
      'want the assistants of winning head coaches, so coaching trees grow the way the NFL’s do. Each coach’s card says ' +
      'what he’s like around the league.',
  },
  {
    version: '0.2.24',
    date: '2026-10-29',
    title: 'Moods matter',
    text:
      'A player’s mood now counts. Young players grow a little faster when they’re happy and slower when they’re not, ' +
      'everyone plays a touch better or worse on game day, a happy player learns a new position faster, and an ' +
      'unhappy one asks more to re-sign with less patience. The Locker Room and the head coach’s report say who it’s ' +
      'costing.',
  },
  {
    version: '0.2.23',
    date: '2026-10-29',
    title: 'Letters close between jobs',
    text: 'A player’s letter to you closes when you leave the club, instead of showing buttons that answer nothing.',
  },
  {
    version: '0.2.22',
    date: '2026-10-29',
    title: 'Players speak up',
    text:
      'An unhappy player with a reason you could act on now writes to you, in his own words: he wants more snaps, a new ' +
      'deal, an end to the losing or the feud in his room. Promise him what he asked for, reassure him, or be firm. ' +
      'Promises are tracked to the game or the re-sign window and remembered: keep one and he trusts you, break one and ' +
      'he trusts your next word less. Two players the same week come as one letter. The Locker Room and his card show ' +
      "what you've promised, and AI clubs answer their own players the same way. Still no effect on play.",
  },
  {
    version: '0.2.21',
    date: '2026-10-29',
    title: 'Morale',
    text:
      'Every player has a mood now. His contract, his role, the team winning or losing and his friends and feuds all ' +
      'move it, and big moments (a benching, a raise, the C, a friend cut) jolt it before they fade. A depth player ' +
      "is glad of his spot; a starter kept off the field is not. You see your players' moods as smileys on the Roster " +
      'and a morale board in the Locker Room (what is on their minds, who needs a word), as a pill on the player card, ' +
      "and in the head coach's locker room report. The player card is cleaner up top: pills only. Morale doesn't change " +
      'play yet.',
  },
  {
    version: '0.2.20',
    date: '2026-10-29',
    title: 'Contracts you can act on',
    text:
      'The re-sign window opens with one letter from your director: every expiring player, his ask, the market and ' +
      "your staff's call (keep, tag or let him walk) with the reason. Sign at his ask, tag him, let him walk or " +
      'negotiate right there in the inbox. The staff contracts letter adds Let go and a call on each coach, scout and ' +
      'medic. And the draft no longer picks for you by accident: the top bar takes you to the draft room, and ' +
      'auto-drafting asks first.',
  },
  {
    version: '0.2.19',
    date: '2026-10-29',
    title: 'Fewer, fuller letters',
    text:
      'Your inbox stops piling up one-line letters. The head coach writes a locker room report four times a year (camp, ' +
      "cut-down day, deadline week and the season's end): captains and leaders, mentoring pairs that aren't working and " +
      "who he'd pair them with instead, friction, friendships and who grew up. Waiver news comes as one letter a day, " +
      'with young players worth a claim at your thin spots, your place in line and a Claim button. Position changes ' +
      "arrive in one letter, the staff's coaching notes get a weekly letter of their own, and game recaps stick to the game.",
  },
  {
    version: '0.2.18',
    date: '2026-10-28',
    title: 'Coaching trees',
    text:
      "Coaches come from somewhere now. Three seasons on a head coach's staff puts a man in his tree, and once two " +
      'of his assistants run clubs of their own the league calls it a tree. Trees run hot or wither on their head ' +
      "coaches' results, a few founding trees are there from the start, and new ones grow over a long save. A new " +
      'head coach brings his own people, hot trees get the interviews, and coordinators often run what their mentor ' +
      "ran. The coach card shows a coach's tree, and SNN covers trees being born and old mentors meeting their " +
      'disciples.',
  },
  {
    version: '0.2.17',
    date: '2026-10-28',
    title: 'The locker room',
    text:
      'Players remember. They warm to a coach they played well for and sour on one who benched or cut them; they ' +
      'come home cheaper and hold a grudge against a club that let them go. Men in the same position room become ' +
      "friends over the years, or fall out, especially when one takes the other's job or gets paid over him. Your " +
      'position coaches tell you about it, the Locker Room tab shows who is close and who is not, outspoken players ' +
      'say their piece on SNN, and recaps note a revenge game or a clutch one.',
  },
  {
    version: '0.2.16',
    date: '2026-10-28',
    title: 'Mentors and captains',
    text:
      "Veterans now mentor young players. Over a season together a young player picks up his mentor's work ethic, " +
      "temper and poise, the good and the bad, a little at a time. Your position coaches pair them unless you'd " +
      'rather pick, and the new Locker Room tab shows who leads your room, your captains and how each pair is going. ' +
      'Your coaches write when a young player is learning, when he loses his mentor, and when he has grown up.',
  },
  {
    version: '0.2.15',
    date: '2026-10-28',
    title: 'Personalities',
    text:
      'Every player now has a personality your scouts can put a name to: a Consummate Pro, a Mercenary, a Ring ' +
      'Chaser, a Clutch kicker or a Jittery one, a Dirty Player, a Company Man. The player card shows the name and ' +
      "one sentence on what stands out, and it's only your scouts' read, so it can be early word or wrong. Dirty " +
      'players draw the late-hit flags, and players who tighten up when it counts pick up bad habits under pressure ' +
      'more easily than the steady ones.',
  },
  {
    version: '0.2.14',
    date: '2026-10-28',
    title: 'Draft-day trades',
    text:
      "The draft trades now. Teams move up when the player they want most won't last to their pick, and move down " +
      'when they see a player almost as good later, prize the extra pick, or have holes to fill, priced the way NFL ' +
      "front offices price picks. When you're on the clock, teams that want your pick call you: their offers sit " +
      "under the clock with your staff's word, and they're gone once you pick. Shop this pick asks the league " +
      'yourself, and Call teams ahead gets the price of the picks just before yours. Draft history shows who a pick ' +
      'came from and the deal behind a draft-day trade. Draft classes are a little stronger, so a league holds its ' +
      'talent once its first generation of veterans has retired.',
  },
  {
    version: '0.2.13',
    date: '2026-10-28',
    title: 'The trade desk',
    text:
      'The Trades tab opens on a trade desk that says what needs you: offers waiting, a physical to decide, deadline ' +
      'day or a quiet week, with the deadline and your block at a glance. Offers lead with the kind of call and your ' +
      "staff's take: the head coach, scouts, doctors and cap each say if they like it. The trade table shows what the " +
      "other club wants on your scouts' read, who it's shopping and whether it's still taking calls; your listed " +
      'players sit on cards with how many teams have asked; and the Market shows every front office on one page. ' +
      'The trade table is a deal slip: you add players and picks from a picker that opens on the ones that fit, ' +
      'filter by position or search by name, and remove anything with one tap.',
  },
  {
    version: '0.2.12',
    date: '2026-10-28',
    title: 'Trades open with a practice squad',
    text:
      'The trade table no longer blanks the whole game in a league with practice squads: squad players show on ' +
      'each side as untradable, marked practice squad. And if a front office tab ever breaks again, it shows what ' +
      'went wrong with a Try again button, while the rest of the game keeps working.',
  },
  {
    version: '0.2.11',
    date: '2026-10-28',
    title: 'The draft room',
    text:
      'Draft day has a war room: who is on the clock (gold when it is you), the last few picks, and your next one. ' +
      "Your staff's top five sit right under it. On the big board, a bar runs from each prospect's grade now to his " +
      'ceiling, so a safe pick and a boom-or-bust project look different at a glance, and a pill says where your ' +
      'staff parts from the league: a sleeper you like more, a fade you like less. Draft history marks how every pick ' +
      "turned out in your scouts' eyes: an early read for two seasons, then a hit, a miss or a steal for good.",
  },
  {
    version: '0.2.10',
    date: '2026-10-27',
    title: 'Draft busts and late bloomers',
    text:
      "A prospect's ceiling is now a best guess on draft day. Over his first three seasons it settles, a lot in " +
      'year one and less after: hard workers and players who outplay their grades tend to rise, and some ' +
      'first-rounders stall where they are. A rookie shows a wide ceiling range that tightens as he settles, his ' +
      'scout report says how far along he is, and your head coach or director writes when one of your young ' +
      'players hits a wall or breaks out.',
  },
  {
    version: '0.2.9',
    date: '2026-10-27',
    title: 'Hire coaches off other staffs',
    text:
      'Like AI teams, you can now hire another team’s coach for the job one rung above his: a position coach as your ' +
      'coordinator, a coordinator as your head coach. Offer the job from his profile, or tick "Include other staffs" ' +
      'in the head coach and coordinator candidates. His team can’t block a promotion, but it only works in the ' +
      're-sign window and free agency, and never for a man his team hired this year.',
  },
  {
    version: '0.2.8',
    date: '2026-10-27',
    title: 'No side of the ball left without a coach',
    text:
      'When your offensive or defensive coordinator chair is empty, your head coach now runs that side himself: his ' +
      'own scheme, and teaching a little below his usual level. A switch on the open chair turns it off. And your ' +
      'owner will always find enough to hire the cheapest coordinator on the market, even after a losing season, ' +
      'so a tight budget can no longer leave you stuck with nobody.',
  },
  {
    version: '0.2.7',
    date: '2026-10-27',
    title: 'Trade checks test every deal on its merits',
    text:
      'Nothing changes in play. The checks that try to trick general managers into bad deals now deal with a team ' +
      'outside your division, leave both sides room under the cap and never send a kicker or punter, so every ' +
      'answer comes from what the GM thinks of the deal rather than a league rule.',
  },
  {
    version: '0.2.6',
    date: '2026-10-27',
    title: 'Sharper trade checks',
    text:
      'Nothing changes in play. The checks that try to trick general managers into bad deals now aim at real stars ' +
      'and real mid-level starters in every league, so a pass means the GM truly said no. Two leagues had looked ' +
      'open to tricks: on a closer look, the GMs there were judging fairly all along.',
  },
  {
    version: '0.2.5',
    date: '2026-10-27',
    title: 'Scouts talk about size',
    text:
      'Scout reports now say what an unusual build means ("undersized for an outside corner; the slot suits him"), and ' +
      'a Size outlier tag marks those players on the card and at the combine. Good scouts can tell when a small ' +
      'player plays bigger than his size. Your head coach speaks up when a hand-made depth chart puts the wrong build ' +
      'in a spot, opposition reports point out a big height edge, and some general managers now pass on undersized ' +
      'prospects that others will gladly take.',
  },
  {
    version: '0.2.4',
    date: '2026-10-27',
    title: 'The right body in the right spot',
    text:
      'An auto-sorted depth chart now lines your starters up by build: the tall corners outside with the small one at ' +
      'nickel, the big receivers at X and Z with the quick one in the slot, the heavier tackle over the nose, and the ' +
      'longest lineman at tackle. Who starts is still decided by how good they are. Your coaches can also suggest a ' +
      'move when a player is built for another position, like a heavy safety who looks like a linebacker.',
  },
  {
    version: '0.2.3',
    date: '2026-10-27',
    title: 'Size matters on the field',
    text:
      'A tall receiver now wins more jump balls over a small corner, a heavy line moves a light front, a short-armed ' +
      'tackle has a harder time with a speed rusher, and a short passer finds fewer lanes downfield. Each edge is ' +
      'small and only the extremes feel it, so a great small player still wins most of his battles, and now and then ' +
      'an undersized one plays bigger than his size.',
  },
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
