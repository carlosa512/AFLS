# Weather

> **Status (first slice).** Built: roof types and announced changes by season (`data/stadiums.ts`),
> climate for 25 cities (Sep–Jan), a seeded roll per game, retractable roofs declared on the
> short-range forecast, the cost table from §2 applied as passing, kicking, punting and fumble levers
> plus AI play mix and field-goal range (`weather.ts`, `match/gameSim.ts`, `match/coach.ts`), forecasts
> at three stages with calibrated rain chances, and weather on the schedule, the next-game card and the
> box score. Checked by `npm run weather`.
>
> Not yet: regional storm systems (§4C), gusts, night games, precipitation starting mid-game and
> in-game roof closing (§6B), postseason roof rules and player roof override (§6C–D), footing, heat
> stamina and altitude (no fatigue system yet), `weatherToughness` and climate familiarity (§7E),
> injury hooks (§7F), impact notes and staff advice on the preview card, forecast trend arrows (the
> calendar has weeks, not days), °C/km/h and "simple weather" settings, international games. Climate
> for DAL, HOU, ARI, SEA and SF is approximate until checked against NOAA. Weather quirks (Tier C in
> `QUIRKS.md`) can now be built on this.

# Weather System Specification

Oct 17, 2026 · @Carlos Ancira

# 1. Overview & Objectives

Weather for every outdoor game is rolled once at season start from real city climate data, stays hidden, and is revealed to the player through forecasts that sharpen as kickoff approaches. Indoor games ignore weather entirely, and retractable roof games resolve their roof status 2 days out.

The system ties three things together: real stadium roof types for all 32 teams, a climate model per stadium city and month, and an FM-style forecast layer that creates uncertainty (a 70% rain forecast can still end dry). Weather then feeds the match engine through modifiers on passing, kicking, ball security, stamina and footing, calibrated to real NFL historical splits.

**Design goals:**

- **Real market authenticity:** Every team plays in its real stadium type, so a Lions home slate is always climate controlled while Buffalo and Green Bay carry real December risk.
- **Fog of war:** The player plans around forecasts, not certainties. Preparing for snow and getting a clear day is part of the experience.
- **Meaningful decisions:** Weather should change game plans, kicker choices, depth chart usage and roster construction (cold weather toughness, big-leg kickers) without overwhelming team quality.
- **Save integrity:** True weather is seeded at season start, so reloading a save cannot reroll a storm.
- **Calibrated, not cartoonish:** Effect sizes are anchored to historical data in Section 2. Most weather has light to moderate impact; only 20+ mph wind and heavy snow are heavy.

# 2. Historical Research: How Weather Affects NFL Play

Wind is the most reliable weather factor and the main driver of the system; rain and cold are moderate, light snow barely matters, and heavy snow and 20+ mph wind are the only heavy effects. Dome games score almost 4 more points per game than outdoor games, and 20 stadiums are open to the elements ([Covers](https://www.covers.com/nfl/how-weather-affects-betting)).

## A. Baselines

- **Average NFL game wind:** about 7 mph. Treat this as the neutral point.
- **Baseline FG%:** about 83% in clear, calm conditions at normal attempt distances.
- **Ideal temperature band:** 55 to 85°F shows no meaningful performance change.

## B. Measured Effects by Condition

| Condition | Passing production | Kicking | Severity |
| --- | --- | --- | --- |
| Wind 0 to 7 mph | Normal | FG% \~83% | None |
| Wind 7 to 10 mph | Slight drop | Minimal change | None |
| Wind 10 to 15 mph | Noticeable drop | \~83%, coaches start shortening attempts | Light |
| Wind 15 to 20 mph | Drops again by a similar step | \~80% on shorter kicks | Light to moderate |
| Wind 20+ mph | Drop is 1.5 to 2x the prior step | Attempts \~7 yds shorter; 77% made vs \~89% expected | Heavy |
| Rain (any intensity) | About 12% lower | \~2% below expected for distance | Moderate |
| Light snow | About 2% lower | Close to normal | None |
| Heavy snow | About 25% lower | 76% made vs \~88% expected | Heavy |
| Cold 25 to 55°F | About 5% lower | Slight | Light |
| Extreme cold under 25°F | About 8% lower | Shorter distance, harder ball | Moderate |
| Extreme heat over 85°F | About 8% lower | Normal | Moderate (stamina) |

Source for all rows: [Covers weather study](https://www.covers.com/nfl/how-weather-affects-betting). A Wharton study of EPA per play also found a significant linear drop in passing EPA as wind rises, while rushing EPA held up or improved in extreme wind ([Wharton](https://wsb.wharton.upenn.edu/wp-content/uploads/2022/09/2022_Football_Parks_Weather.pdf)).

## C. Design Takeaways

- **Rain intensity barely matters in the data.** Model rain as a mostly binary flag for passing, with intensity only affecting fumbles and footing.
- **Snow intensity matters a lot.** Light and heavy snow must be separate states.
- **Coaches adapt.** Real FG% looks stable in wind because coaches stop trying long kicks. The AI coach must shorten its FG range in wind, or kick stats will look wrong.
- **Effects compound.** Rain with gusts or snow with cold should stack, with a cap so games stay playable.
- **Data gap:** nflverse records `roof`, `temp` and `wind` per game but not precipitation, so precipitation odds must come from NOAA climate data ([nflreadr schedules dictionary](https://cloud.r-project.org/web/packages/nflreadr/vignettes/dictionary_schedules.html)).

# 3. Stadium & Roof Classification (stadiums.ts)

For the 2026 season, 6 teams play fully indoors, 5 have retractable roofs, and 21 play outdoors across 20 stadiums. Roof type maps directly to the nflverse `roof` values so historical data lines up with sim data.

## A. Roof Types

- **`dome` (fixed indoor):** Weather system skipped. Conditions locked at 72°F, 0 mph wind, no precipitation (the same convention analysts use for nflverse dome games).
- **`retractable`:** Resolves to `open` or `closed` per game using Section 6 logic. Closed behaves exactly like `dome`.
- **`outdoors`:** Full weather applies. Optional `windShelter` modifier for stadiums whose design blocks wind.

## B. 2026 Team Table

| Team | Stadium | Roof | Notes |
| --- | --- | --- | --- |
| ARI | State Farm Stadium | retractable | Desert heat; roof closed most games |
| ATL | Mercedes-Benz Stadium | retractable | Roof stayed closed for all but one game in its first season ([AJC](https://www.ajc.com/sports/finished-roof-opens-new-option-for-falcons-home-games/iQVQA7iiItfuFNPUcI218L/)) |
| BAL | M&T Bank Stadium | outdoors |  |
| BUF | New Highmark Stadium | outdoors | Opened 2026; overhang covers \~60% of seats and cuts field-level wind ([AP via KCTV5](https://www.kctv5.com/2026/08/11/nfl-teams-have-new-or-revamped-stadiums-planned-every-year-between-now-2031/)). Use `windShelter` |
| CAR | Bank of America Stadium | outdoors |  |
| CHI | Soldier Field | outdoors | Lakefront wind |
| CIN | Paycor Stadium | outdoors |  |
| CLE | Huntington Bank Field (lakefront) | outdoors | Lake Erie wind and lake-effect snow |
| DAL | AT&T Stadium | retractable | Also has retractable end walls |
| DEN | Empower Field at Mile High | outdoors | Altitude: longer kicks, faster fatigue for visitors |
| DET | Ford Field | dome |  |
| GB | Lambeau Field | outdoors | Coldest late-season climate |
| HOU | NRG Stadium | retractable | Opens only in roughly 50 to 80°F with no real rain threat |
| IND | Lucas Oil Stadium | retractable | Mandatory close at 40°F, 40 mph gusts or nearby precipitation |
| JAX | EverBank Stadium | outdoors | Reduced capacity in 2026 during renovation |
| KC | GEHA Field at Arrowhead | outdoors |  |
| LAC | SoFi Stadium | dome | Fixed canopy; treat as indoor |
| LAR | SoFi Stadium | dome | Fixed canopy; treat as indoor |
| LV | Allegiant Stadium | dome |  |
| MIA | Hard Rock Stadium | outdoors | Heat and humidity early season |
| MIN | U.S. Bank Stadium | dome | Large doors follow retractable wall rules; no gameplay effect |
| NE | Gillette Stadium | outdoors |  |
| NO | Caesars Superdome | dome |  |
| NYG | MetLife Stadium | outdoors | Swirling wind |
| NYJ | MetLife Stadium | outdoors | Swirling wind |
| PHI | Lincoln Financial Field | outdoors |  |
| PIT | Acrisure Stadium | outdoors |  |
| SEA | Lumen Field | outdoors | Rain-heavy climate; partial roof over seats |
| SF | Levi's Stadium | outdoors |  |
| TB | Raymond James Stadium | outdoors | Heat, humidity, storm delays |
| TEN | Nissan Stadium | outdoors | Final outdoor season (see C) |
| WAS | Northwest Stadium | outdoors |  |

Retractable roof policies for HOU and IND come from [Football Zebras](https://www.footballzebras.com/2013/05/nfl-retractable-roof-policies/). Stadium names reflect 2026 and should be stored as data, not hardcoded.

## C. Scheduled Stadium Changes

Stadiums change over a long save, so `roofType` must be keyed by season. Announced changes ([AP via KCTV5](https://www.kctv5.com/2026/08/11/nfl-teams-have-new-or-revamped-stadiums-planned-every-year-between-now-2031/)):

| Season | Team | Change | New roof |
| --- | --- | --- | --- |
| 2027 | TEN | New Nissan Stadium, enclosed | dome |
| 2027 | JAX | Home games played in Orlando during construction | outdoors (Orlando climate) |
| 2028 | JAX | Renovated EverBank, open-air with translucent covering | outdoors + `windShelter` |
| 2029 | CLE | New domed stadium in Brook Park | dome |
| 2030 | WAS | New stadium at RFK site with a roof | dome |
| 2031 | KC | New fully enclosed Arrowhead | dome |
| 2031 (possible) | CHI | Proposed stadium in Hammond, Indiana; roof not announced | TBD |

By 2031 the outdoor count drops from 21 teams to 17, which shifts how often weather matters league-wide. Fictional or future relocations should use the same season-keyed record.

# 4. Season-Start Weather Generation (weatherGen.ts)

Once the schedule is built, every outdoor and retractable game gets one hidden `TrueWeather` roll, seeded from the save ID and game ID so it never changes on reload. Dome games get the fixed 72°F / 0 mph / dry record and skip the rest.

## A. Data Sources

- **NOAA 1991 to 2020 Climate Normals:** Monthly average high and low, precipitation and snowfall totals, and frequency of precipitation days for the weather station nearest each stadium. Hourly normals add wind speed and wind chill ([NOAA Normals Quick Access](https://ncei.noaa.gov/cdo-web/datatools/normals), [data.gov catalog](https://catalog.data.gov/dataset/u-s-climate-normals-2020-u-s-monthly-climate-normals-1991-2020)).
- **nflverse game history (1999 onward):** Actual kickoff `temp` and `wind` per outdoor game. Used to fit wind distributions per stadium and month, and to calibrate the generator so sim seasons look like real ones.
- **Pre-baked file:** Both sources are compressed into `climate.json` (one record per stadium per month) at build time. No live API calls in game.

## B. Roll Order per Game

1. Resolve the home stadium for that season (Section 3C) and its roof type. Dome: write the fixed record and stop.
2. Get kickoff month and time slot. Night games roll about 6 to 10°F colder than the daytime mean (tuning value).
3. **Temperature:** Normal distribution around the monthly mean for that hour, with the month's standard deviation. Clamp to the record range.
4. **Wind:** Sample from the stadium-month wind distribution fit to nflverse history (a gamma fit works well for skewed wind data). Multiply by `windShelter` if present. Add gusts as sustained × 1.3 to 1.6.
5. **Precipitation chance:** Use NOAA frequency of measurable precipitation days for that month. If precipitation rolls true, choose type by temperature: 34°F or below is snow, 35 to 38°F is a mixed or sleet roll, above 38°F is rain.
6. **Intensity:** Rain is `light` or `heavy` (affects fumbles and footing only). Snow is `light` or `heavy`, weighted by the city's snowfall normal, so Buffalo and Green Bay produce heavy snow far more often than Philadelphia.
7. Write the result to the hidden `TrueWeather` record.

## C. Regional Weather Systems (optional, recommended)

Real storms hit several stadiums in the same week. Before rolling individual games, roll one weekly system per region (Northeast, Great Lakes, Mid-Atlantic, Southeast, Plains/Mountain, West Coast). An active system raises precipitation odds and wind for every game in that region that week, so Buffalo, New England and the Jets can share a storm weekend.

## D. Determinism

```ts
const seed = hash(saveId, season, gameId);
const rng = seededRandom(seed);
const trueWeather = rollWeather(climate[stadiumId][month], slot, rng);
```

The same seed must always produce the same weather. Forecast noise (Section 5) uses a separate RNG stream so viewing forecasts never shifts the true roll.

# 5. Forecast & Fog of War (forecast.ts)

The player never sees `TrueWeather` before kickoff; they see a forecast whose error shrinks in four stages, and whose percentages are calibrated so a 70% rain forecast verifies about 70% of the time. Calibration is what makes the forecast worth trusting and still capable of being wrong.

## A. Forecast Stages

| Stage | When it shows | What the player sees | Temp error | Wind error | Precip signal strength |
| --- | --- | --- | --- | --- | --- |
| Climate outlook | Season start to 8 days out | City and month averages only | n/a | n/a | 0.0 (pure climate odds) |
| Extended forecast | 7 to 3 days out | Conditions, % chance, ranges | ±8°F | ±6 mph | 0.5 |
| Short-range forecast | 2 to 1 days out | Tighter ranges, roof decision | ±3°F | ±3 mph | 0.8 |
| Kickoff | Game day | Actual conditions | 0 | 0 | 1.0 |

All error and signal values are starting tuning points, not researched figures.

## B. Calibrated Precipitation Percentages

Do not flip a coin between "show the truth" and "show a random roll". Instead, blend the climate prior with the hidden truth:

```ts
// truth = 1 if TrueWeather has precip, else 0
const signal = STAGE_SIGNAL[stage];            // 0.0, 0.5, 0.8, 1.0
let p = prior + (truth - prior) * signal;      // pull toward truth
p += gaussian(forecastRng) * NOISE[stage];     // small jitter
const shownPct = clamp(roundTo10(p * 100), 0, 100);
```

This yields real uncertainty. Early on a dry game in rainy Seattle can still show 40%, and a few 70% games will stay dry. Track forecast hit rates in testing to confirm the shown percentages match outcomes.

## C. Temperature and Wind Ranges

Show a range centered on a noisy estimate, for example "Wind 12 to 18 mph, gusts to 25". The center is `true + gaussian * error[stage]`, so the true value usually, but not always, sits inside the range. Snow vs rain labels follow the forecast temperature, which creates natural "rain or snow?" uncertainty near freezing.

## D. Forecast Persistence

Forecasts update once per sim day, not every time the screen opens, and each update stores its own value. This keeps the schedule screen from flickering and lets the player see trends ("rain chance rising from 30% to 60%").

## E. Staff Hook (future)

Forecasts are public in the real world, so baseline accuracy is league-wide. A future hook can let an elite Sports Science or Analytics staff read field and wind conditions better on game day, mirroring the scouting error margins in the injury spec.

# 6. Retractable Roof Logic (roof.ts)

Each retractable stadium has a roof policy, and the sim applies it to the short-range forecast 2 days out; most games end up closed, matching real team behavior. In the real league the home team must declare open or closed up to 90 minutes before kickoff ([Football Zebras](https://www.footballzebras.com/2013/05/nfl-retractable-roof-policies/)), and teams like Atlanta announce intentions about 2 days early ([AJC](https://www.ajc.com/sports/finished-roof-opens-new-option-for-falcons-home-games/iQVQA7iiItfuFNPUcI218L/)), so the 2-day reveal fits real practice.

## A. Team Roof Policies

| Team | Opens only when | Source |
| --- | --- | --- |
| HOU | About 50 to 80°F with no significant rain threat | [Football Zebras](https://www.footballzebras.com/2013/05/nfl-retractable-roof-policies/) |
| IND | Must close at a forecast of 40°F, 40 mph gusts, or nearby precipitation | [Football Zebras](https://www.footballzebras.com/2013/05/nfl-retractable-roof-policies/) |
| ARI, DAL, ATL | No published thresholds found; use default: 60 to 80°F, wind under 15 mph, rain chance under 20% | Tuning default |

Store these as editable data so modders and future updates can change them.

## B. In-Game Rules (from NFL policy)

- **Closing mid-game:** An open roof can be closed up to 5:00 left in the 4th quarter if rain starts or hazardous weather approaches. Play continues while it closes.
- **Late game:** After 5:00 of the 4th quarter and through overtime, the roof stays open in rain unless there is a safety issue.
- **No reopening:** Once closed, before or during a game, the roof cannot reopen.
- **Real precedent:** The first in-game reversal happened at State Farm Stadium on Nov. 3, 2024, when rain and hail hit in the 1st quarter; closing took about 10 minutes.

To support this, `TrueWeather` stores a `precipOnsetQuarter` so precipitation can begin mid-game. If it starts while the roof is open, the sim closes it and all weather modifiers drop to dome values from the next drive.

## C. Postseason

- **Wild Card and Divisional:** The league decides using the team's written policy, so apply the same team policy.
- **Conference Championships and Super Bowl:** League games where the commissioner decides. Use the default policy, leaning toward open in good weather.

## D. Player Control (optional)

If the player is the home team with a retractable roof, let them override the policy at the 2-day mark, within league safety limits. Opening the roof against a dome-based visiting offense in bad weather is a legitimate strategic call.

# 7. Match Simulation Effects (gameSim.ts)

Weather applies per-play modifiers to a small set of engine levers, and those levers are tuned until simulated season splits match the real targets in Section 2. Tune to outputs, not to guesses about inputs.

## A. Engine Levers

- **Pass accuracy:** Completion chance, scaled more for deep throws than short ones.
- **Pass distance:** Max effective air yards (wind into the face, cold ball).
- **Ball security:** Fumble and muffed-snap chance (rain, snow, extreme cold).
- **Footing:** Speed, cutting and route timing (heavy rain, heavy snow, frozen turf).
- **Kicking:** FG and XP make chance plus max distance; punt distance and hang time.
- **Stamina drain:** Per-snap fatigue (heat and humidity, altitude).

## B. Target Outcomes to Calibrate Against

| Condition | Passing production target | Kicking target | Other levers |
| --- | --- | --- | --- |
| Wind 10 to 15 mph | Noticeable drop, roughly equal to the 15 to 20 step | No change at same distance | Punt variance up |
| Wind 15 to 20 mph | Another equal-size drop | \~80% on shorter attempts | Deep pass penalty grows |
| Wind 20+ mph | Drop 1.5 to 2x the prior step | \~77% on kicks that should be \~89% | Heaviest deep pass and punt effects |
| Rain (any) | About 12% lower | \~2% below expected for distance | Fumbles up; heavy rain hurts footing |
| Light snow | About 2% lower | Near normal | Minor footing |
| Heavy snow | About 25% lower | \~76% on kicks that should be \~88% | Footing and visibility; run game favored |
| 25 to 55°F | About 5% lower | Slight distance loss | None |
| Under 25°F | About 8% lower | Shorter max distance | Fumbles up slightly |
| Over 85°F | About 8% lower | Normal | Stamina drain up; rotation matters |

Targets from [Covers](https://www.covers.com/nfl/how-weather-affects-betting). Rushing should hold steady or improve slightly in extreme wind ([Wharton](https://wsb.wharton.upenn.edu/wp-content/uploads/2022/09/2022_Football_Parks_Weather.pdf)).

## C. Stacking & Caps

- Effects multiply (rain with 20+ mph wind stacks both penalties).
- Cap the total passing production penalty at about 40% so even blizzard games stay playable. Tuning value.
- Wind direction is optional for MVP. If added, apply headwind and tailwind by quarter since teams switch ends.

## D. AI Coach Adaptation

- **FG range:** The AI shortens its max FG attempt by about 7 yards in 20+ mph wind and heavy snow, matching the real drop in attempt distance. Without this, sim kick stats will look wrong.
- **Play mix:** Shift run/pass ratio and shorten passing depth as conditions worsen.
- **4th down:** More go-for-it decisions when long kicks and punts are unreliable.

## E. Player & Team Factors (design choices, not researched)

- **Hidden `weatherToughness` (1 to 20):** Slightly reduces personal penalties for QBs, receivers, kickers and ball carriers. Scouted with error, like injury proneness.
- **Climate familiarity:** Teams that practice outdoors in cold climates take slightly smaller cold penalties than dome-based teams visiting in December. Keep this small.
- **Altitude (DEN home):** Longer kick distance and faster visitor stamina drain.

## F. Injury System Hooks

- Heat feeds stamina drain, which feeds the existing "<65% condition" injury threshold. No separate heat injury roll needed.
- Frozen or waterlogged turf adds a small multiplier to soft-tissue and collision injury checks.

# 8. UI & Player-Facing Presentation

Weather lives in three places: a schedule column, a match preview card, and a post-game record, each showing only what the current forecast stage allows.

## A. Schedule Screen Column

- **Dome games:** A small roof icon and "Indoors". No forecast.
- **Retractable games:** "Roof: TBD" until 2 days out, then "Open" or "Closed".
- **Outdoor games:** Weather icon plus the headline number, for example a cloud with "Rain 60%" or a snowflake with "Snow 30%". Climate outlook games use a muted style and an "Avg" tag so they are not mistaken for real forecasts.
- **Trend arrow:** Up or down arrow when the chance changed since the last daily update.

## B. Match Preview Card

- Forecast stage label ("Extended forecast, 5 days out").
- Temperature range, wind range with gusts, precipitation type and chance, roof status.
- **Impact summary:** Plain-language lines tied to Section 7, such as "High wind: deep passing and long field goals affected". Show severity as None / Light / Moderate / Heavy, matching the research scale.
- **Staff note:** A coordinator suggestion when conditions look heavy ("Consider a run-heavy plan"). Advisory only.

## C. Kickoff & Post-Game

- At kickoff, the card flips to actual conditions. If the forecast missed, show a short "Forecast called for rain; game stayed dry" line so the fog of war is visible.
- Box scores and game logs store actual weather, so players can filter stats by condition later.

## D. Accessibility

- Icons always pair with text labels, never color alone.
- Settings toggle for °F / °C and mph / km/h.
- Optional "Simple weather" setting that hides percentages and shows only None / Light / Moderate / Heavy for players who want less to track.

# 9. Data Model & Execution Flow (types.ts)

Four core types carry the system: stadium records keyed by season, the hidden true weather, the visible forecast snapshots, and per-play modifiers.

## A. Types

```ts
export type RoofType = 'dome' | 'retractable' | 'outdoors';
export type RoofStatus = 'dome' | 'open' | 'closed' | 'outdoors'; // matches nflverse
export type PrecipType = 'none' | 'rain' | 'mixed' | 'snow';
export type PrecipIntensity = 'light' | 'heavy';
export type ForecastStage = 'climate' | 'extended' | 'short' | 'kickoff';
export type Severity = 'none' | 'light' | 'moderate' | 'heavy';

export interface StadiumSeasonRecord {
  teamId: string;
  season: number;            // first season this record applies
  stadiumName: string;
  climateStationId: string;  // NOAA station key into climate.json
  roofType: RoofType;
  windShelter?: number;      // 0.0 to 1.0 wind multiplier, e.g. 0.8
  altitudeFt?: number;
  roofPolicy?: RoofPolicy;   // retractable only
}

export interface RoofPolicy {
  minTempF: number;
  maxTempF: number;
  maxWindMph: number;
  maxPrecipChance: number;   // 0 to 1
}

export interface TrueWeather {       // hidden until kickoff
  gameId: string;
  tempF: number;
  windMph: number;
  gustMph: number;
  precipType: PrecipType;
  precipIntensity?: PrecipIntensity;
  precipOnsetQuarter?: 1 | 2 | 3 | 4; // supports mid-game roof closing
  roofStatus: RoofStatus;
}

export interface ForecastSnapshot {  // one stored per sim day
  gameId: string;
  stage: ForecastStage;
  dayIssued: number;
  tempRangeF: [number, number];
  windRangeMph: [number, number];
  precipType: PrecipType;
  precipChance: number;      // shown %, rounded to 10s
  roofStatus: RoofStatus | 'tbd';
  severity: Severity;
}

export interface WeatherModifiers {  // applied per play in gameSim.ts
  passAccuracy: number;      // multipliers, 1.0 = neutral
  deepPassAccuracy: number;
  maxAirYards: number;
  ballSecurity: number;
  footing: number;
  fgAccuracy: number;
  kickDistance: number;
  staminaDrain: number;
}
```

## B. Execution Flow

1. **Season start:** Build schedule, resolve stadium records for the season, roll regional systems, roll `TrueWeather` for every game (Section 4).
2. **Daily tick:** For games 7 or fewer days out, issue a new `ForecastSnapshot` at the right stage (Section 5).
3. **2 days out:** Resolve retractable roofs from the short-range forecast and team policy (Section 6).
4. **Kickoff:** Reveal `TrueWeather`, build `WeatherModifiers`, adjust AI coach FG range and play mix.
5. **During match:** Apply modifiers per play; handle `precipOnsetQuarter` and mid-game roof closing.
6. **Post-game:** Write actual weather to the box score and game log for stat filtering.

## C. Files

- `stadiums.ts`: Season-keyed stadium records and roof policies.
- `climate.json`: Pre-baked NOAA plus nflverse stats per station and month.
- `weatherGen.ts`: Season-start rolls and regional systems.
- `forecast.ts`: Stage logic and calibrated percentages.
- `roof.ts`: Retractable decisions and in-game closing.
- `gameSim.ts`: Modifier application and AI adaptation.

# 10. Tuning, Balancing & Open Questions

Validate the system by simulating 100+ seasons and comparing league-wide splits to real history; the main risk is weather swinging results more than team quality does.

## A. Validation Checks

- **Climate realism:** Sim distribution of kickoff temp and wind per stadium and month should match nflverse history within a few degrees and mph.
- **Effect realism:** Passing production and FG% by condition should land near the Section 7 targets.
- **Scoring gap:** Indoor games should average roughly 4 more points than outdoor games, as in real data.
- **Forecast calibration:** Of games shown at 70% rain, about 70% should see rain.
- **Competitive balance:** Weather should not flip the expected winner in more than a small share of games. Set a target during tuning.

## B. Open Questions

- [ ] Night game temperature offset: fixed value or derived from NOAA hourly normals?
- [ ] Include wind direction in MVP, or defer?
- [ ] Should `weatherToughness` exist at launch, or wait for the core system to be tuned?
- [ ] Default roof thresholds for ARI, DAL and ATL: find published policies or keep the default?
- [ ] Weather-driven relocations or postponements (snowstorm moves, hurricanes): include as rare events?
- [ ] International games: add climate records for London, Munich, Madrid and others as needed.

## Sources

Pages opened for this spec:

- [Covers: How Weather Actually Impacts NFL Games](https://www.covers.com/nfl/how-weather-affects-betting) (updated Aug. 31, 2026)
- [AP via KCTV5: NFL teams have new or revamped stadiums planned through 2031](https://www.kctv5.com/2026/08/11/nfl-teams-have-new-or-revamped-stadiums-planned-every-year-between-now-2031/) (Aug. 11, 2026)
- [Football Zebras: NFL retractable roof policies](https://www.footballzebras.com/2013/05/nfl-retractable-roof-policies/) (updated Nov. 3, 2024)

Also referenced from search results:

- [Wharton: Weather and NFL efficiency (EPA)](https://wsb.wharton.upenn.edu/wp-content/uploads/2022/09/2022_Football_Parks_Weather.pdf)
- [nflreadr schedules data dictionary](https://cloud.r-project.org/web/packages/nflreadr/vignettes/dictionary_schedules.html)
- [NOAA U.S. Climate Normals Quick Access](https://ncei.noaa.gov/cdo-web/datatools/normals)
- [AJC: Falcons retractable roof usage](https://www.ajc.com/sports/finished-roof-opens-new-option-for-falcons-home-games/iQVQA7iiItfuFNPUcI218L/)
