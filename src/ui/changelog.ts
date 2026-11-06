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
    version: '0.4.7',
    date: '2026-11-06',
    title: 'Who falls on it',
    text:
      'A loose ball now goes where football sends it. One punched out by a defender usually ends up with the defense; ' +
      'one the carrier simply drops mostly stays with his team. A catch that comes loose downfield is usually a ' +
      'defensive back’s, a strip-sack’s is usually a lineman’s, and what happens next depends on who has it: a safety ' +
      'picks it up and runs, a tackle falls on it, and a long return usually goes all the way. Strip-sacks come more ' +
      'off the edge than up the middle, less on third down when the quarterback braces for the hit, and more when he ' +
      'is holding on trailing late. The numbers match the NFL’s.',
  },
  {
    version: '0.4.6',
    date: '2026-11-06',
    title: 'Fumbles come from the hit',
    text:
      'Whether a tackled man fumbles now depends on the tackle: a hard hitter and a heavy one jar it loose more, a ' +
      'ball-stripper rips at it, and a defense that needs the ball late goes for it. A back fighting for the sticks on ' +
      'third and fourth down, or for every yard when his team trails late, puts it on the ground more; one protecting ' +
      'a lead covers it up. Scramblers can fumble too. The play tells you why it came out, and only a fumble a ' +
      "defender caused counts as a forced fumble. Rates by down and by situation match the NFL's.",
  },
  {
    version: '0.4.5',
    date: '2026-11-05',
    title: 'The passer chooses',
    text:
      'A quarterback now decides what to do once he has read the play: throw it, throw it away or take off, as NFL ' +
      'passers do. Under pressure or with nobody open he may scramble or get rid of it, more on third down for the ' +
      'sticks and in the red zone, almost never on fourth down under pressure, and trailing late he stays in the pocket. ' +
      'Quarterbacks with legs run more, good decision-makers give up on a dead play rather than force it, and a ' +
      'gunslinger rarely throws it away. A throwaway from inside the pocket can be flagged for intentional grounding: ' +
      'loss of down and ten yards, or a safety from his own end zone.',
  },
  {
    version: '0.4.4',
    date: '2026-11-05',
    title: 'Out of bounds is a choice',
    text:
      'A ball carrier at the sideline now goes out the way NFL players do: most are run out by a defender, and some step ' +
      'out themselves when the clock calls for it, the first-down marker is behind them, or a hit is coming. A receiver ' +
      'alone in the open keeps running, a man protecting a lead cuts back inside, and big backs and tight ends fight for ' +
      'the extra yard. A man who steps out takes no hit. Outside the last minutes of a half the clock stops until the ' +
      'ball is spotted, as in the NFL.',
  },
  {
    version: '0.4.3',
    date: '2026-11-05',
    title: 'The right man gives up the sack',
    text:
      'On the field under your games, the lineman charged with a sack is now the one the matchup says lost, every ' +
      'time, and the field shows him getting beaten: no more sacks charged to nobody, or to the tackle on the other ' +
      'side. A tight end blamed for a sack stays in to block on the film.',
  },
  {
    version: '0.4.2',
    date: '2026-11-04',
    title: 'A new job starts with a clean desk',
    text:
      'Take over a new club and your inbox no longer fills with letters about team meetings it held before you ' +
      'arrived, written as if you had made the calls. You hear about the meetings held on your watch. On the All-22, ' +
      'a quarterback no longer stands where the defense falls on a fumble, the blocker who gave up a sack is the one ' +
      'beaten, a receiver no longer slides out of bounds after an overthrow, and a jump-cutter shows his broken tackle. ' +
      'On the field under your games, a man who goes out of bounds is chased out by a defender, not left to step out alone.',
  },
  {
    version: '0.4.1',
    date: '2026-11-04',
    title: 'The pocket on the field',
    text:
      'On the field under your games, every dropback now plays out in the trenches: linemen take their men, the ' +
      'center slides to help, a back stays in to chip, linebackers come late, and the quarterback sets, steps up, ' +
      'slides away from the rush or breaks out to scramble. Who gets home and who lost him are the men the film shows, ' +
      'and a sack takes as long on the clock as it does on the field. Games played before keep their old pocket.',
  },
  {
    version: '0.4.0',
    date: '2026-11-04',
    title: 'Coaches matter on Sunday (alpha)',
    text:
      'Your coordinators and head coach now lift their players on game day, as far as the room believes in them. Bad ' +
      'losses wear that belief down, faster when a locker-room lawyer is stirring it, and your position coaches warn ' +
      'you when a room starts to slip. Your head coach can ask to meet the room: stand behind his coordinator, or put ' +
      'him on notice. From camp through the regular season you can relieve a coordinator and hand his side to the ' +
      'head coach or a position coach, and other clubs now do the same when it comes to that. With this, every item ' +
      'on the road to alpha is done.',
  },
  {
    version: '0.3.12',
    date: '2026-11-04',
    title: 'Locker room touch-ups',
    text:
      "In the Locker Room, the players a team meeting's promise names are now links to their cards, and a promise of " +
      "talks with two players names them both. The head coach's season's-end report now tells a promise you made in " +
      'your own address to the team as yours, not his. And a hurt quarterback no longer counts toward how long the ' +
      'passing game has played together.',
  },
  {
    version: '0.3.11',
    date: '2026-11-04',
    title: 'Out of bounds is out of bounds',
    text:
      'On the field under your games, a run or a catch that ends out of bounds now ends with the ball carrier stepping ' +
      'out at his spot, a defender chasing him or coming at him, and nobody is credited with a tackle. A catch the ' +
      'field ends with nobody on him no longer names a tackler either, just as a run already did.',
  },
  {
    version: '0.3.10',
    date: '2026-11-04',
    title: 'A field under your games',
    text:
      'Your own games now play out on a real field: every player has a body, a speed and a read, the back picks his ' +
      'hole and his cuts, defenders take angles and try to bring him down, kickoff coverage runs in lanes against ' +
      'the return team, and after a pick or a strip-sack the offense turns and chases. The All-22 shows how he got ' +
      'where he got. The result of each play still comes from the engine you know, so winning and losing work as ' +
      'before. Games played earlier keep their old replay.',
  },
  {
    version: '0.3.9',
    date: '2026-11-03',
    title: 'Chemistry on Sunday',
    text:
      'How a room feels now shows a little on the field. A position group that is clicking plays slightly better and ' +
      'one that is out of sync slightly worse, and a line, a secondary or a quarterback and his receivers who have ' +
      'played together for years gel. The men a room listens to rub off on it: a Spark spreads his mood, good or bad, ' +
      'and an Anchor keeps a room steady. Winning clubs can get comfortable, unless a driven leader keeps them hungry. ' +
      'Each room in the Locker Room shows its chemistry and why, your Sparks and Anchors are tagged, and your head ' +
      'coach tells you when a room starts clicking or falls out of sync.',
  },
  {
    version: '0.3.8',
    date: '2026-11-03',
    title: 'Re-signing keeps a meeting promise',
    text:
      "When a team meeting promised talks with a player's agent and you then re-signed him, the game missed " +
      'it and counted the promise as broken, so he stayed upset with you. Signing him now keeps the promise. Saves ' +
      "from this season are put right when they load. The head coach's note about how the players take his word now " +
      'says so plainly, and what it means for your next team meeting.',
  },
  {
    version: '0.3.7',
    date: '2026-11-03',
    title: 'Faster checks behind the scenes',
    text:
      'Nothing changes in the game. The checks every change runs through before it reaches you now finish sooner, ' +
      'so fixes and new features can land without waiting on them.',
  },
  {
    version: '0.3.6',
    date: '2026-11-03',
    title: 'Real heights',
    text:
      "Players' heights now follow real NFL rosters, inch by inch, position by position, so a new league no longer has " +
      'a dozen 6\'9" linemen or 5\'7" corners piled at the edges. Weights stay inside the real range for each position. ' +
      'Draft classes can still bring the rare build one inch past the real extremes, about once a decade at a ' +
      'position. Coaches only move a player to a position where real rosters carry his height, and a moved player ' +
      "ends up at a weight that position really plays at. Existing saves keep their players' builds; new arrivals " +
      'come in on the real curves. ' +
      "On the All-22, a defender the run's blocking leaves free is no longer grabbed by a lineman on his way to someone " +
      'else, so he no longer stands in the hole.',
  },
  {
    version: '0.3.5',
    date: '2026-11-03',
    title: 'Your coach asks for a word',
    text:
      'Your head coach now comes to you when a room needs a meeting: what he sees, what he’d say, and three quick ' +
      'calls for you (how to put it, what to tell them, when). Afterwards he writes what he told them, how each man ' +
      'took it and what you now owe them, and he reminds you a week before a promise comes due. The Locker Room lets ' +
      'you ask for a meeting with any room, shows what each room is still owed, and in a real crisis lets you address ' +
      'the team yourself, with a captain telling you how it went down. New leagues start with their captains named.',
  },
  {
    version: '0.3.4',
    date: '2026-11-03',
    title: 'Team meetings around the league',
    text:
      'Head coaches around the league now hold team meetings: at camp, deadline week, the playoff push and the ' +
      'season’s end, and when a room turns on itself. Each player takes it his own way, some promises behind them are ' +
      'kept and some broken, and every head coach carries a word with his room that rises and wears thin; a coach who ' +
      'has lost his room and keeps losing is a little closer to the door. Your own coach’s meetings, and his letters ' +
      'about them, come in the next update.',
  },
  {
    version: '0.3.3',
    date: '2026-11-03',
    title: 'Runs that read like film',
    text:
      'In All-22 the run game now plays out like it does on Sundays. The line blocks by the call (zone steps, a ' +
      'pulling guard on power, the edge sealed or kicked out) and the back presses the hole, reaching the line about ' +
      'three seconds after the snap, then cuts and bursts. When he breaks a tackle you see the move (a juke, a jump ' +
      'cut, a spin, a stiff arm or a run through the hit) against the man who missed. A breakaway leaves the safety a ' +
      'step late, and a back who falls forward lunges for the last yard. Habits show too: a patient runner, a ' +
      'linebacker who shoots his gap, a guard who pulls soft. Returns end in a pile rather than one man, and a long ' +
      'one can show a cover man made to miss. The man who makes the tackle either comes to meet the ball carrier or ' +
      'runs him down from behind; he never runs past him and back. Defenders no longer stop dead when their part is over.',
  },
  {
    version: '0.3.2',
    date: '2026-11-02',
    title: "The young players' review",
    text:
      'When your season ends, the director of scouting sends one letter on the young players instead of a letter ' +
      'for each: who looks better than we graded him, which rookies are who we thought, and who is behind where we ' +
      "had him. The words follow his year, so a rookie is never written off: it's early, and his ceiling has two " +
      'more seasons to settle. The letter files in the week your season ends, with the rest of that week’s mail.',
  },
  {
    version: '0.3.1',
    date: '2026-11-02',
    title: 'Nobody teleports',
    text:
      'In All-22, nobody moves faster than his own legs any more. Tacklers take an angle on the ball carrier, or run ' +
      'him down from behind with a closing sprint no quicker than the fastest NFL players, and a man who misses ' +
      'carries on past and goes down instead of freezing. Players pull up after the whistle. Kickoff coverage waits ' +
      'for the ball to land. The victory formation looks like one: the quarterback under center, two up-backs, a man ' +
      'deep, and a real kneel. Highlight rings show at the moment, so they no longer give away who makes the tackle.',
  },
  {
    version: '0.3.0',
    date: '2026-11-02',
    title: 'Trade requests',
    text:
      'An unhappy player can now ask to be traded: over playing time, the losing, a feud with a teammate, or a deal ' +
      'he never got after holding in or out. He tells his club first, and your head coach writes to you: shop him, ' +
      'refuse, or promise him the snaps or the deal he wants. It stays private for a while, sooner with an outspoken ' +
      'man, until it leaks; then every club knows, calls come in, and the offers come in low. Refused and still ' +
      'unhappy at the next camp, he may hold in instead. Other clubs face the same, and you can buy their unhappy ' +
      'players for less once the word is out. This finishes morale and holdouts on the road to alpha.',
  },
  {
    version: '0.2.46',
    date: '2026-11-02',
    title: 'Routes',
    text:
      'Receivers now run real routes in All-22, as plays drawn up together: smash, flood, mesh, four verticals, ' +
      'curl-flat, stick and more, leaning on what each offense likes. The man the ball goes to runs the route that ' +
      'fits his catch, with a stem, a hard plant and a break, and everyone else runs his part and settles where it ' +
      'ends. Wide receivers line up on the numbers. Man coverage is a step late out of a break, and receivers are as ' +
      'open at the catch as the NFL’s are. On a screen to the back the line sells the pass, then leads the way, ' +
      'and a throwaway sails out of bounds downfield. Under pressure the quarterback steps up or slides before the ' +
      'rusher gets there and throws as he arrives.',
  },
  {
    version: '0.2.45',
    date: '2026-11-02',
    title: 'Hold-ins and holdouts',
    text:
      'A player who is unhappy with his contract, and stays unhappy after talks go badly, can now dig in. Most hold in: ' +
      'they report but sit out practice, and miss the work. A proud veteran starter may hold out instead: he goes on ' +
      'the Did Not Report list, is fined for missing camp, loses a game check for every week he stays away, and comes ' +
      'back rusty. Your head coach writes when one starts and asks how to answer: open talks, promise a new deal, hold ' +
      'firm or shop him. Other clubs think it over as camp goes on, the way NFL teams do: most holdouts end by the ' +
      'last week of camp, and a few run into the season until a deal is done. The Roster, the Locker Room and the ' +
      'player card show who is holding out or in.',
  },
  {
    version: '0.2.44',
    date: '2026-11-02',
    title: 'The pocket',
    text:
      'Quarterbacks now play the pocket in All-22. They drop deeper for deeper throws, fake to the back on about ' +
      'three early downs in ten, roll out on bootlegs, step up into a clean pocket, and climb or slide away when the ' +
      'rush gets there. The line forms a cup around them, and the rusher who got home loops around the man he beat. ' +
      'Sacks take as long as the NFL’s, from quick ones to coverage sacks after five seconds, and the sacker takes ' +
      'the quarterback down where the sack lands. Throws leave on the NFL’s timing, and a deep ball hangs in the ' +
      'air. Play labels now say when a fumble was lost or kept, and when a fourth down turned the ball over.',
  },
  {
    version: '0.2.43',
    date: '2026-11-02',
    title: 'Fumbles you can see',
    text:
      'A fumble now looks like one when you watch it. The ball pops loose where the hit lands and bounces a few ' +
      'yards while players from both sides go for it, and the man who recovers it falls on it or picks it up. If ' +
      'the defense gets it, it can return it, and the offense chases him down. The player who fumbled stays down ' +
      'instead of running on backwards, in the broadcast view and in All-22. Strip-sacks look the same way.',
  },
  {
    version: '0.2.42',
    date: '2026-11-02',
    title: 'Numbers of their own',
    text:
      'Players now pick their own numbers, the way NFL players do: receivers in the 80s and single digits, corners ' +
      'in single digits, linemen in the 50s, each to the rules for his position. A newcomer takes his favourite if ' +
      'it is free, or one close to it, instead of the next number up, and a player who changes position keeps his ' +
      'number if the rules allow it there. In a career already under way, players move to their favourites as they ' +
      'come free each new league year; a number you set yourself stays. In All-22, the line no longer steps up ' +
      'before every snap, and motion and shifts follow the rules.',
  },
  {
    version: '0.2.41',
    date: '2026-11-02',
    title: 'Long careers stay quick',
    text:
      'Nothing changes in play. Finding a club’s players no longer means reading every player the league has ever ' +
      'had, retired ones too, so long careers slow down less: five seasons play about a tenth faster, and the gap ' +
      'grows the longer a career runs.',
  },
  {
    version: '0.2.40',
    date: '2026-11-02',
    title: 'Colour rush',
    text:
      'Clubs now dress up for big games. Under the lights a club may wear its colour rush, one colour head to toe ' +
      '(some clubs go all white), and eight clubs also have a blackout. Once or twice a season each club wears its ' +
      'classic uniform at home, often against a division rival. Every number is now outlined so it reads at a ' +
      'glance, and some clubs have their own number style.',
  },
  {
    version: '0.2.39',
    date: '2026-11-02',
    title: 'Who runs the room',
    text:
      'Your locker room now has a shape. Some players lead and some have a voice, from their makeup, whether they ' +
      'start, their years in the league and here, and what they have won, and their moods count for more in how ' +
      'their room is feeling. The Locker Room has a card for each room with its mood, what stands out, who it ' +
      'follows, its mentoring and its feuds. The head coach covers the rooms at the start and end of the season, a ' +
      'position coach writes when his guys turn, and a yellow Negotiate button opens contract talks from a room, a ' +
      'player’s card or his letter.',
  },
  {
    version: '0.2.38',
    date: '2026-11-02',
    title: 'Helmets on',
    text:
      'Every player now wears his club’s helmet, each club in its own design and each player in one of eight shells, ' +
      'linemen in their wider cage. The back carries the US flag, a Pathway player’s country under it, and the green ' +
      'dot on the quarterback and the defence’s play-caller. Quarterbacks can wear a padded sleeve and a play-call ' +
      'wristband, and you can pick any player’s helmet and wristband from the pencil on his card.',
  },
  {
    version: '0.2.37',
    date: '2026-11-02',
    title: 'Fewer sulkers',
    text:
      'Players are happier with deals that pay them close to their worth: only a man paid well under his market ' +
      'complains, and a backup feels it less than a starter. A star still on his rookie deal wants his extension but ' +
      'doesn’t turn bitter over it. And a player you’ve moved into the starting job no longer complains about snaps ' +
      'before the season has even started. Free agency days also run about three times faster.',
  },
  {
    version: '0.2.36',
    date: '2026-11-01',
    title: 'Any given Sunday',
    text:
      'Teams now have good days and bad ones, so upsets come about as often as in the real league, and a new league ' +
      'starts as even as one that has played for years. Quarterbacks throw like today’s NFL too: mostly short, with ' +
      'screens and checkdowns, fewer intermediate chain-movers, and the deep shot when it’s there. Play-callers differ ' +
      'more, so some offenses throw far more than others, and a great passer’s accuracy counts in full. Front offices ' +
      'act like real ones: they plan next year’s cap before they borrow, contenders spend and rebuilders save, they ' +
      'tag the star they’d otherwise lose, and good veterans find a club by camp.',
  },
  {
    version: '0.2.35',
    date: '2026-11-01',
    title: 'Your gear, captains and rookies',
    text:
      "The pencil on a player's card now edits his gear too: pick his sleeve, band, elbow pads and shoulder brace, " +
      'which arm and what colour, and watch his picture change; "Back to his own" undoes it. Captains wear their ' +
      'patch on their card, a star for each season in a row as captain and solid gold after five. Rookies have a red ' +
      '"R" beside their name in depth charts, lists and on their card, and in a cold game most players now wear ' +
      'their sleeves with only a brace or bands over them.',
  },
  {
    version: '0.2.34',
    date: '2026-11-01',
    title: 'Gear',
    text:
      'Players wear their own gear in their pictures: arm sleeves of every length and shooter sleeves, undershirt sleeves, biceps and ' +
      'forearm bands, elbow pads and the odd shoulder brace, each the way his position dresses, receivers and corners ' +
      'in sleeves and bands, linemen in elbow pads and now and then a sleeve. A player keeps his look for his career, ' +
      'and in a cold or snowy game most pull on full sleeves, except the offensive line.',
  },
  {
    version: '0.2.33',
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
    version: '0.2.32',
    date: '2026-11-01',
    title: 'Before the snap, fouls and the chase',
    text:
      'All-22 now shows the seconds before the snap. The line sinks into its stance, and about half of snaps have ' +
      'motion (more for offenses built on it): jets, orbits, shifts. ' +
      'The defense answers by its scheme: a man defender travels with the motion while a zone bumps over, safeties ' +
      'show one shell and rotate at the snap, linebackers walk up to show a blitz and bail, or creep up late to time ' +
      'a real one. The quarterback barks to send the motion and to call for the ball (a ripple from him), and now ' +
      "and then tries a hard count, which an offside man jumps. The defense plays the engine's call on each snap: a blitz " +
      'sends a linebacker or a defensive back, run defense puts a safety in the box, and zone defenders drop to their ' +
      'coverage. Every foul is acted out where and when it happened, by the player who committed it: a false start ' +
      'is one lineman moving early, offside a man across at the snap, a hold a blocker hanging on to his man, a late ' +
      'hit at the whistle, a kickoff out of bounds sailing over the sideline. The nearest official throws the flag on ' +
      'him (two flags when fouls offset). On long gains, defenders chase from behind, miss tackles or fall off the ' +
      'play instead of running alongside the carrier, and the quarterback is ringed only while the play is his.',
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
