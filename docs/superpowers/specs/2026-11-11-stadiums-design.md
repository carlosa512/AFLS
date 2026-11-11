# Stadiums: a building for every club

Date: 2026-11-11 · Builds on the broadcast work (parts one to three, merged in #174) · The owner's ask after that
merge

Mockups (agreed Nov 11):

- First ideas for all 37 buildings, flat: https://claude.ai/artifact/XqBgn3fvnnnTZuNFLF6S6e
- Five buildings drawn with depth, the look to build: https://claude.ai/artifact/DGYvVJsHcfX3FGCTCkNFmg

The second page's source is kept beside this spec (`2026-11-11-stadiums-prototype.html`): it is the drawing code the
game's painter starts from, so nothing agreed is lost if the page is.

## Why

The broadcast field has a stand behind it: one flat band of dots, the same for every club, under a strip of sky.
The owner wants every club to play in its own building, seen from the broadcast camera as a slice (the near side
cut away, as now), with the walls, the decks and the roof drawn.

The first flat sketches read as walls with dots on them. What the owner approved instead is a bowl with depth: the
crowd sits on rows that rake back from the field and bend round the corners. That needs a real camera, and a real
camera changes three things at once: the field gets a little smaller, the sky leaves the picture, and the roof and
the land outside have to be real things in the same space or they read as wallpaper.

## Decisions

Agreed with the owner (Nov 11) unless marked as a call still open.

0. **Screens only.** Nothing in `src/engine/` changes, nothing is added to the save, no tuning number moves. The
   game already knows each club's roof and each stadium to come (`data/stadiums.ts`), each game's weather
   (`weather.ts`) and each club's record.
1. **A bowl with depth.** Every row is its own line in space, each higher and further from the field than the one
   in front. Decks hang over the rows below with a dark gap where the concourse runs. The stands bend round the
   corners and run toward the camera at each end. Stairs split the crowd into sections, with tunnels.
2. **One camera for everything** in the broadcast view: the building, the land outside, the field's paint and the
   play. The field is smaller in the picture than today (about 14% narrower, 22% shorter). Both bench areas stay.
3. **The near side stays cut away**, as now: the near stand, the near wall and the near part of any roof are not
   drawn. The stands at each end run off the sides of the picture.
4. **There is no sky.** This camera looks down, so the top of the picture is the land beyond the far side, or the
   roof. Night and weather are shown by light and by what falls (Decision 9).
5. **A roof is a real slab**, cut where the near side is cut. You look down on its top, and its cut edge shows how
   thick it is. It runs off both sides of the picture; the cut across the middle is straight. A roof that opens has
   an opening over the field and its leaves parked to either side. An open-air roof covers the back rows only.
6. **The land outside is real ground** in the same space, after each club's real city: downtown, out of town, on a
   river, on a lake, in the desert. It follows the lie of the land only. No real landmark and no real stadium is
   copied; every building is original and starts from the club's nickname.
7. **Detail is the point.** Buildings have floors and windows. Woods are packed tight enough that no ground shows.
   Car parks have rows of cars; streets have lane marks and traffic. People are drawn only in the stadium: no
   figures in windows or on streets.
8. **Crowds follow the record.** A winning club's ground is full; a losing club's has empty seats, first high up,
   at the ends and in whole sections. The owner saw about half full for "losing" and accepted it.
9. **Night and weather without a sky.** A night game darkens the land outside and lights its windows; the ground
   stays floodlit. Rain and snow still fall over the picture as now. Snow lies on the land outside and on
   roofs while it falls. A roof that opens is drawn open or closed as the game has it.
10. **Every club has its own building:** 32, plus the five the game already has coming (Tennessee 2027,
    Jacksonville 2028, Cleveland 2029, Washington 2030, Kansas City 2031), each from its season on.
11. **Reviewed a division at a time, before any game code.** Eight pages of four, like the agreed page. The owner
    reviews each. Game code starts only when all eight are approved and the owner says "build it".
12. **All-22 is untouched.** Its paint and its camera stay as they are.

Calls still open, with the default this spec builds if nothing is said:

- **Which way Cincinnati faces.** Its far bank is low-rise, which the owner found sad. Default: as drawn (the river
  behind). The other way turns the building round so downtown stands behind it.
- **The two New York clubs and the two Los Angeles clubs.** Default: each its own building.
- **A neutral-site game.** Default: the listed home club's building, with the crowd in both clubs' colours, as the
  end zones already do it.
- **The crowd early in a season.** Default: the first three home games of a season are drawn at the "even" level
  at least, whatever the record (hope sells tickets); a playoff game is always full.

## The picture

The frame stays 360 by 188 units (`VIEW_W`, `VIEW_H`).

**The camera** is a pinhole, fitted so the field sits where the owner approved it: 102 yards up, 100 yards back
from the near sideline, pitched down 0.11 radians, focal length 272.668, with the picture's centre line at
−50.919. With it the far sideline is at y = 90 and 200 wide for the 120 yards between the end lines; the near
sideline is at y = 172 and 296 wide. (Today: 68 and 226; 168 and 346.)

`broadcastView.ts` becomes this camera. `project(fx, fy, h, quarter)`, `pt`, `quad`, `groundFrame`, `flat` and
`facing` keep their names and what they mean; `groundFrame` reads its two vectors off the camera at the spot instead
of off a straight-line map. Everything that draws through them (the ball, the lines, the drive's band, the yard
numbers, the midfield mark, the end zones' letters, the benches) moves with it and needs no change of its own.
Teams still switch ends each quarter through `stadiumSpot`; the building never moves.

**The bowl's plan** is a rounded rectangle round the field: 7 yards of apron beyond each sideline and each end
line, corners of 12 yards' radius. A row at distance `d` behind the wall is that outline pushed out by `d`. The near
part is cut at 12 yards in front of the near sideline; the frame cuts the rest.

**The decks** every building shares unless it says otherwise, kept low so the roof or the land has room:

| Deck  | From the wall | Height    | Rows |
| ----- | ------------- | --------- | ---- |
| Lower | 0 to 14 yd    | 1.1–6.6   | 14   |
| Club  | 13 to 19 yd   | 9–11.8    | 6    |
| Upper | 18 to 31 yd   | 13.8–21.4 | 14   |

Each deck has a front face with a ribbon board in the club's colours and a rail. Behind the top row a back wall
rises to the rim, or to the roof's underside.

**A roof slab** covers the building beyond a cut at 50 yards from the near sideline (just short of the far
sideline). Its height over the length of the field is the building's own (flat, arched, a canoe's sheer). Its cut
face is drawn as a section: a pale fill, a web of struts, a heavy outline.

**The land outside** starts at a plaza ring 10 yards wide round the building. What shows of it over the far side is
about 95 yards of ground (from 142 to 236 yards beyond the near sideline), and more at the two top corners.

## A building's description

A building is data, not code: one record a club in `src/ui/stadiums/` (screens only; not engine data).

- **Decks:** the shared three, or its own.
- **Rim:** the back wall's top along the bowl (flat, peaks, battlements, a crown, gables).
- **Open ends:** which part of the bowl has only its lower deck (a horseshoe).
- **Roof:** none; a canopy over the back rows; or a slab (its profile, its skin and section colours, and for a roof
  that opens, the opening and the leaves).
- **Colours:** seats, empty chairs, the wall, the deck faces.
- **Features:** named things from a small set the painter knows how to draw in space (stacks, a wheel, masts,
  towers, a spire, a clock tower, a gantry). A building lists which and where. A new kind is added to the painter
  once and can then be used by any building.
- **Setting:** which land is outside (a city of a given height, car parks, woods, a river with bridges, a lake, a
  hillside, desert) and its particulars.

Buildings are keyed by club abbreviation, and a club's later building by the season it opens. The roof kind of a
building must match the game's (`STADIUMS[abbrev]`, with `changes`): a dome is a slab with no opening, a
retractable roof a slab with one, outdoors none or a canopy. A league whose abbreviations are not in the list (a
mod) gets one plain bowl in its own colours.

## The crowd

A seat is taken or empty. Whether it is taken is decided by a seeded draw for that seat against the turnout of its
section, so the same seats empty every time for a club, and a seat taken in a thin crowd is taken in a full one.

Turnout comes from the home club's record coming into the game (`recordBefore`, the standings anyone can see):

| Record coming in      | Level   | Seats taken |
| --------------------- | ------- | ----------- |
| .600 or better        | Winning | 97%         |
| .400 to under .600    | Even    | 80%         |
| Under .400            | Losing  | 52%         |

Within a level, the lower deck fills first and the upper deck last; the ends are thinner than the sidelines; and
each section leans a little its own way, so whole blocks thin out together. The first three home games of a season
are never below Even, and a playoff game is full. Taken seats are in the home club's colours, as now; a neutral site
splits the colours.

The crowd still answers a score or a takeaway for the home side: the picture of the stands brightens for a beat
(the same `data-cheer` hook as now). Nobody in it moves.

## Night and weather

Read from what the viewer already reads (`weatherAt(gameWeather(...), quarter)`):

- **Night:** the land outside goes dark, with its windows lit. The ground itself stays floodlit: it is the lit
  thing in the picture (the owner, Nov 11: a dark stadium looks like it needs a light).
- **Rain, snow:** the falling layer over the picture stays as it is. Snow lies on the land outside and on roofs
  while it falls, and on a freezing day from December on. No building is snowy of its own accord (the owner, Nov
  11: "No constant snow"): on a clear autumn day Buffalo is green.
- **A roof that opens:** `open` draws the opening and the leaves; `closed` draws the roof whole, with its seam. A
  dome is always whole.
- **Under a roof** nothing falls inside and the light is even. The day outside still shows, and stops at the roof:
  rain or snow falls above the roof's edge and no lower, and snow lies on the roof and the land. The game plays a
  roofed ground as indoors and says nothing of the day outside, so the picture rolls its own from the place and the
  month (`outside.ts`: seeded by the game, read by nothing in the sim; the owner, Nov 11: "it has no bearing
  anyway").

## Painting and speed

The building, the land and the crowd are painted once on a canvas and kept as a picture behind the layer that
carries the play (the field's lines, the ball, banners: still SVG, through the same camera). A building is about
10,000 seats and a few thousand shapes outside; the prototype paints one in about 130 ms on a desktop.

- It is painted when the screen opens and again only when what it shows changes: the quarter's weather, or the roof
  opening or closing. Never while a play is running.
- The canvas is sized to the device, to at most 1440 pixels wide.
- Budget: one painting in 300 ms or less on a mid-range phone. If a building misses it, the land outside is thinned
  before the crowd is.
- All draws come from the seeded `Rng`, keyed by the club: the same building is the same picture every time.

## What it replaces

- `broadcastView.ts`: the straight-line map becomes the camera above.
- `BroadcastPaint.tsx`: the flat stand, its crowd of dots, the sky, the two flags and the light towers go. The
  field's own paint (`FieldGround`, `FieldPosts`) stays and is drawn through the new camera. `WeatherFall` stays.
- `BroadcastField.tsx` and `IdleField`: the building's picture sits where the stand was.
- The crowd's cheer (`bf-hop`, `bf-roar` on the dots) becomes the brightening of the picture.

## Tests

- **Camera:** the four corners of the field land where this spec says; a spot nearer the camera is lower in the
  picture; a spot higher above the grass is higher in it; the switching-ends tests still hold.
- **Buildings:** every club in `TEAM_SEEDS` has one; every `changes` entry in `STADIUMS` has its later building;
  each building's roof kind matches the game's for its seasons; an unknown abbreviation gets the plain bowl.
- **Crowd:** turnout rises with the record; a seat taken at a lower level is taken at every higher one; the early
  home games and the playoffs follow their rules.
- **Painter:** the same club, season, weather and record give the same list of shapes (drawn into a recorder, since
  the suite has no canvas); nothing reads `Math.random`.
- **The screen contract** tests still pass: no rating reaches the screen.
- **A look in the browser** before a PR is called ready: an open-air ground, a dome and a roof that opens; day,
  night, rain and snow; full and thin crowds; desktop and phone; Broadcast still agreeing with All-22 on the play.

## The 37 buildings

**Tone (the owner, Nov 11): realism over theme.** A building should read as a real stadium first. Pittsburgh's
furnace stacks and New York's keep are the level to aim for; ship's masts and sails on Baltimore and New England were
dropped. Ideas below that lean on a costume (sails, a carnival tent, a star truss) are to be drawn as plainer
buildings whose materials, roofline and setting carry the club.

First ideas, from the concept page. Each division is drawn and reviewed before it is built, so every line here can
still change. "Setting" is the lie of the land round the real ground, nothing more.

**Liberty East**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Buffalo Blizzard | Storm porch: a roof over the back rows, glass behind it | Open air, canopy | Out of town: car parks in the snow, a road, thick woods |
| Miami Barracudas | Fin blades: shade blades round a bowl with open corners | Open air | Out of town: car parks, palms, flat suburb, a canal |
| New England Admirals | Flagship: three masts, a stern gallery of windows | Open air | Out of town: thick woods, car parks, a low shopping street |
| New York Knights | The Keep: battlements, four square towers | Open air | Marshland, water channels, a highway, car parks |

**Liberty North**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Baltimore Clippers | Clipper rig: raked masts, one end open | Open air | In town: rail yards, brick blocks, the harbor beyond |
| Cincinnati Steamers | Riverboat: white decks, twin stacks, a paddlewheel in the open end | Open air | On the river: bridges, a boat, a town on the far bank |
| Cleveland Hammers | Mill yard: a sawtooth roofline, a gantry carrying the lights | Open air | On the lake: docks, the water to the top of the picture |
| Pittsburgh Forge | Blast furnace: glowing stacks, a yellow truss | Open air | Where rivers meet: bridges, the city across the water |

**Liberty South**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Houston Wildcatters | Long slot: lattice trusses, a roof that slides open along the field | Opens | Out of town: wide car parks, flat suburb |
| Indianapolis Racers | Speedway: a banked oval, checkered trim, a roof that folds back | Opens | In town: blocks, rail lines |
| Jacksonville Tarpons | Sun bowl: low and wide open, palm courts in the corners | Open air | On the river: car parks, a bridge |
| Tennessee Outlaws | Stockade: palisade walls, a ranch gate | Open air | On a river bank, a bridge to the city across it |

**Liberty West**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Denver Summit | Ridgeline: the rim cut into peaks | Open air | In town: car parks, then streets and city blocks |
| Kansas City Marshals | Courthouse square: a clock tower, star pylons | Open air | Out of town: car parks, a highway junction, grass |
| Las Vegas Mirage | Chrome dunes: a rippled mirror roof | Dome | Desert edge: car parks, a highway, low sheds, rows of palms |
| Los Angeles Condors | Wingspan: two roof wings meeting at a spine | Dome | Suburb: a grid of houses, car parks, a park with a lake |

**Frontier East**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Dallas Stampede | Barn doors: two roof leaves that slide apart | Opens | Suburb: car parks, low sprawl |
| New York Empire | Setback tower: art-deco steps up to a spire | Open air | Marshland, car parks, a rail line |
| Philadelphia Founders | Colonnade: a brick arcade, white columns, a cupola | Open air | Edge of town: car parks, a highway, rows of houses |
| Washington Sentinels | Rampart: two lookout towers with beacons | Open air | Suburb: woods, car parks |

**Frontier North**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Chicago Gale | Windbreak: tall curved baffles on the lake side | Open air | On the lake: a harbor with boats, a park, a shore road |
| Detroit Gears | Cog ring: a toothed steel ring holding the roof | Dome | In town: blocks |
| Green Bay Lumberjacks | Timber lodge: log gables, one end open | Open air | A small town: houses on streets, trees, car parks |
| Minnesota Voyageurs | Canoe hull: the roof an upturned canoe | Dome | In town: towers, snow on the roofs |

**Frontier South**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Atlanta Firebirds | Wings up: two roof leaves lifted like wings | Opens | In town: towers, trees on the streets |
| Carolina Monarchs | Crown: the rim rising into crown points | Open air | Edge of downtown: towers close by, a rail line |
| New Orleans Krewe | Carnival tent: a striped roof, bunting on the decks | Dome | In town beside a raised highway, towers |
| Tampa Bay Corsairs | Sea fort: bastions at each end, sailcloth shade | Open air | Flat: car parks, palms, low buildings |

**Frontier West**

| Club | Idea | Roof | Setting |
| ---- | ---- | ---- | ------- |
| Arizona Scorpions | Pincers: earth walls, two curved roof leaves | Opens | Desert suburb: car parks, low buildings, squares of farmland |
| Los Angeles Stars | Planetarium: a dark roof, one round skylight | Dome | Suburb: a grid of houses, car parks |
| San Francisco Fog | Cable-hung: a thin roof on cables from two towers | Open air, canopy | An office park: low buildings, car parks, a creek |
| Seattle Squall | Storm hood: one deep roof wrapping the bowl | Open air, canopy | South of downtown: rail yards, docks with cranes |

**Coming later in a career**

| Club, from | Idea | Roof |
| ---------- | ---- | ---- |
| Tennessee, 2027 | Lantern barn: a timber barn under a glowing roof | Dome |
| Jacksonville, 2028 | Silver scales: the sun bowl under a shade roof of scales | Open air, canopy |
| Cleveland, 2029 | Mill shed: one long steel shed with sawtooth skylights | Dome |
| Washington, 2030 | The Citadel: a low stone drum under a ring roof | Dome |
| Kansas City, 2031 | Star roof: a roof on one five-pointed star truss | Dome |

Five are drawn with depth already and agreed in look: Denver, Buffalo, Cincinnati, Minnesota and Atlanta. They are
the pattern for the rest.

## Out of scope, for later

- A crowd that moves: standing, waving, leaving early in a blowout.
- Tailgates, people outside, anything on the streets but cars.
- The building in All-22, on the club's page, or in a fly-in before kickoff.
- Attendance as a number, or anything about money or home advantage (that would be the engine's).
- Sound.
