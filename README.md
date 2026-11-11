# AFLS

A deep American football management simulation: run a franchise in a fictional 32-team league, complete with
divisions/conferences, weather, authentic kickoff times, and more. Build the roster and the coaching staff
along with back office staff, and watch every snap play out from real player-vs-player matchups. Everything
your front office knows is what its scouts have seen, so the game lives in the gap between what you believe
and what is true. Think you know ball?

![A week at the desk: home, the head coach's letter, the depth chart, a rookie's card, a trade offer for him, then the locker room and a touchdown in All-22](docs/media/demo.gif)

## Every snap, on film

![One play in All-22: a 46-yard completion down the right side](docs/media/all22.gif)

Watch it live or in play-back in All-22.

## What's in the game

- **Every snap is a matchup.** Real contests between the players on the field, not a random dice roll for the scores sake.
- **You see what your scouts see.** Ranges, not truths. You're only as good as your scouts, and in turn your ability to trust that information.
- **A cap with teeth.** Dead money, restructures, tags, void years - it's all here. You'll wear those mistakes on your cap for years to come.
- **A trade market that fights back.** Rival GMs have habits, a memory of you, and a doctor who reads the file. So no taking advantage of relationships here, betray a friend or befriend a rival, that's up to you.
- **A real locker room.** Moods, promises, holdouts, and trade requests that leak. Players react, much more than they are static. Let the good times, or bad times roll.
- **Staff who matter.** Scouts, coaches and doctors, each with a budget, a market and a carousel. Championships are often won behind the scenes. 
- **A job you can lose.** Owners have patience. It runs out if you don't hold up your end of the bargain.
- **Inbox worth reading.** Your coach, your scouts and your fellow GM, and sometimes even your players all have something to tell you. What you do with all this information is ultimatley your choice.

## Screens

<table>
  <tr>
    <td width="50%"><img src="docs/media/coach-letter.png" alt="The head coach's weekly letter: three players came to see him about their contracts and snaps, each with answer buttons"><br><sub><b>The head coach's letter.</b> Who came to see him, and your answers.</sub></td>
    <td width="50%"><img src="docs/media/trade-offer.png" alt="The trade desk in the dark theme: Buffalo offers three picks for a rookie tackle, with the head coach's and the cap's notes"><br><sub><b>The trade desk.</b> Buffalo's GM wants your rookie tackle in this example.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/locker-room.png" alt="The Locker Room: the room's mood, what is on players' minds, and who needs a word"><br><sub><b>The Locker Room.</b> Who's happy, who isn't, and why.</sub></td>
    <td width="50%"><img src="docs/media/salary-cap.png" alt="The salary cap screen in the dark theme: this year's cap sheet, a five-year outlook chart and the contracts table"><br><sub><b>The cap.</b> Five years out, and what every cut would cost.</sub></td>
  </tr>
</table>

### One player, two seasons apart

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/media/player-card.png" alt="A rookie tackle's card in 2026: overall 15.1, potential shown as a range of 15 to 20, and a scout's report that calls him a projection"><br><sub><b>2026, a rookie.</b> His ceiling is a guess somewhere 15 to 20.</sub></td>
    <td width="50%" valign="top"><img src="docs/media/player-card-two-years-on.png" alt="The same player in 2028: overall 17.4, potential settled at 17, rating arrows and a development curve from 15.1 to 17.1"><br><sub><b>2028, the same player.</b> Now you know a bit more and can see how he's come along.</sub></td>
  </tr>
</table>

## Light and dark, desktop and phone

<table>
  <tr>
    <td width="50%"><img src="docs/media/home.png" alt="Home in the light theme: this week's games, the next opponent, the last result"></td>
    <td width="50%"><img src="docs/media/home-dark.png" alt="The same Home screen in the dark theme"></td>
  </tr>
</table>

<table>
  <tr>
    <td width="25%"><img src="docs/media/phone-home.png" alt="Home on a phone, light theme"></td>
    <td width="25%"><img src="docs/media/phone-all22.png" alt="A replay in All-22 on a phone, the field turned upright"></td>
    <td width="25%"><img src="docs/media/phone-locker-room.png" alt="The Locker Room on a phone, dark theme"></td>
    <td width="25%"><img src="docs/media/phone-player-card.png" alt="A player card on a phone, dark theme"></td>
  </tr>
</table>

## Checked against the NFL

Nothing tuned by feel, all towards NFL ranges:

| Stat              |  Sim | NFL range |
| ----------------- | ---: | --------: |
| Points            | 21.9 | 21.5–23.5 |
| Completion %      | 64.4 |   63–66.5 |
| Yards per attempt | 6.99 |   6.7–7.3 |
| Yards per carry   | 4.21 |   4.1–4.5 |
| Sacks             | 2.33 |   2.1–2.6 |
| Interceptions     | 0.71 | 0.65–0.85 |
| Third-down %      | 39.9 |     37–41 |
| Home team wins %  | 54.5 |     53–57 |

## Play

```bash
npm install
```

```bash
npm run dev
```

Open the URL it prints. It is not hosted anywhere yet.

## Go deeper

- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md): the vision, how it all works, and the roadmap.
- [`docs/MVP.md`](docs/MVP.md): what's built, and the numbers each piece was held to.
- [`CLAUDE.md`](CLAUDE.md): the codebase, the commands and the checks. Start with `npm run check`.

AFLS is a fictional league: real cities, original nicknames, generated people. Not affiliated with the NFL.
