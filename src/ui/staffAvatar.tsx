import { useId } from 'react';
import { gamesInWeek } from '../engine/league';
import type { Coach, League, Medic, Staff } from '../engine/types';
import { gameWeather } from '../engine/weather';
import { contrast, readableOn, shade, tint, type TeamColors } from './color';
import { FREE_AGENT, HOT_KICKOFF_F, SKIN } from './components';
import { isOffseasonPhase } from './format';
import { STAFF_FAMILY, staffLook, type StaffDay, type StaffFamily, type StaffLook } from './staffLook';
import { store } from './store';

// Staff face you (players face the field). Same ring, lighting and grey mannequin as PlayerAvatar.
// Everything that varies is clothing, gear, a head silhouette and, for women, one solid hair shape:
// no faces, skin tones, likenesses or ageing.

/** Kickoff this cold in the open air, the sideline wears jackets and beanies (tune). */
export const COLD_KICKOFF_F = 40;
const DETAIL_MIN_PX = 32; // below this: silhouette, hats and headset only (tune)
const HAIR = '#2A323D';
const PLASTIC = '#1F2937';
const SILVER = '#A3ADB8';
const SUIT = '#2F3A48';
const COAT = '#E9EDF2';
const EDGE = { stroke: '#0F172A', strokeOpacity: 0.35, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' } as const;
const GLOSS = {
  stroke: '#FFFFFF',
  strokeOpacity: 0.32,
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  fill: 'none',
} as const;

interface HeadShape {
  d: string;
  ears: string;
  /** Half the head's width at the temples, for fitting hats and hair (the base head is 12.5). */
  half: number;
  top: number;
}
// head shapes, picked per person: silhouette only, never features
const HEADS: HeadShape[] = [
  {
    d: 'M50 11.4 C58.6 11.4 62.8 13.4 63 19 L63 33 C62.8 37 60.6 39.6 56 40.3 L44 40.3 C39.4 39.6 37.2 37 37 33 L37 19 C37.2 13.4 41.4 11.4 50 11.4 Z',
    ears: 'M62.6 23.8 C65.5 23.2 66.6 26 66.1 29.3 C65.7 32.2 64.1 33.5 62.8 33.1 Z M37.4 23.8 C34.5 23.2 33.4 26 33.9 29.3 C34.3 32.2 35.9 33.5 37.2 33.1 Z',
    half: 13,
    top: 11.4,
  }, // square
  {
    d: 'M50 10.8 C58.4 10.8 62.8 16.4 62.8 24.4 C62.8 33 58.4 40.4 50 40.4 C41.6 40.4 37.2 33 37.2 24.4 C37.2 16.4 41.6 10.8 50 10.8 Z',
    ears: 'M62.4 23.8 C65.3 23.2 66.4 26 65.9 29.3 C65.5 32.2 63.9 33.5 62.6 33.1 Z M37.6 23.8 C34.7 23.2 33.6 26 34.1 29.3 C34.5 32.2 36.1 33.5 37.4 33.1 Z',
    half: 12.8,
    top: 10.8,
  }, // round
  {
    d: 'M50 10 C57.4 10 61.8 15 61.8 23 C61.8 32 57.6 40.6 50 40.6 C42.4 40.6 38.2 32 38.2 23 C38.2 15 42.6 10 50 10 Z',
    ears: 'M61.4 23.8 C64.3 23.2 65.4 26 64.9 29.3 C64.5 32.2 62.9 33.5 61.6 33.1 Z M38.6 23.8 C35.7 23.2 34.6 26 35.1 29.3 C35.5 32.2 37.1 33.5 38.4 33.1 Z',
    half: 11.8,
    top: 10,
  }, // oval
  {
    d: 'M50 10.4 C58.4 10.4 63 15 63 22 C63 30 58.4 37.6 52.6 40.2 C51 40.7 49 40.7 47.4 40.2 C41.6 37.6 37 30 37 22 C37 15 41.6 10.4 50 10.4 Z',
    ears: 'M62.6 23.8 C65.5 23.2 66.6 26 66.1 29.3 C65.7 32.2 64.1 33.5 62.8 33.1 Z M37.4 23.8 C34.5 23.2 33.4 26 33.9 29.3 C34.3 32.2 35.9 33.5 37.2 33.1 Z',
    half: 13,
    top: 10.4,
  }, // heart
  {
    d: 'M50 9.6 C56.8 9.6 60.8 12.4 61 18.6 L61.2 34 C61 37.6 59 39.8 55.6 40.6 L44.4 40.6 C41 39.8 39 37.6 38.8 34 L39 18.6 C39.2 12.4 43.2 9.6 50 9.6 Z',
    ears: 'M60.8 23.8 C63.7 23.2 64.8 26 64.3 29.3 C63.9 32.2 62.3 33.5 61 33.1 Z M39.2 23.8 C36.3 23.2 35.2 26 35.7 29.3 C36.1 32.2 37.7 33.5 39 33.1 Z',
    half: 11.2,
    top: 9.6,
  }, // oblong
];
const WOMAN_HEADS: HeadShape[] = [
  {
    d: 'M50 10.8 C58 10.8 62.2 16.4 62.2 24.4 C62.2 33 58 40.4 50 40.4 C42 40.4 37.8 33 37.8 24.4 C37.8 16.4 42 10.8 50 10.8 Z',
    ears: 'M61.8 23.8 C64.7 23.2 65.8 26 65.3 29.3 C64.9 32.2 63.3 33.5 62 33.1 Z M38.2 23.8 C35.3 23.2 34.2 26 34.7 29.3 C35.1 32.2 36.7 33.5 38 33.1 Z',
    half: 12.16,
    top: 10.8,
  }, // round
  {
    d: 'M50 10 C57 10 61.2 15 61.2 23 C61.2 32 57.2 40.6 50 40.6 C42.8 40.6 38.8 32 38.8 23 C38.8 15 43 10 50 10 Z',
    ears: 'M60.8 23.8 C63.7 23.2 64.8 26 64.3 29.3 C63.9 32.2 62.3 33.5 61 33.1 Z M39.2 23.8 C36.3 23.2 35.2 26 35.7 29.3 C36.1 32.2 37.7 33.5 39 33.1 Z',
    half: 11.21,
    top: 10,
  }, // oval
  {
    d: 'M50 10.4 C58 10.4 62.4 15 62.4 22 C62.4 30 58 37.6 52.5 40.2 C51 40.7 49 40.7 47.5 40.2 C42 37.6 37.6 30 37.6 22 C37.6 15 42 10.4 50 10.4 Z',
    ears: 'M62 23.8 C64.8 23.2 65.9 26 65.4 29.3 C65 32.2 63.5 33.5 62.1 33.1 Z M38 23.8 C35.1 23.2 34 26 34.5 29.3 C34.9 32.2 36.5 33.5 37.9 33.1 Z',
    half: 12.35,
    top: 10.4,
  }, // heart
];

// all paths share one 100x100 box; hair and hats are drawn on the base head and fitted to each shape
// The neck runs on under the clothes (to y 53): necklines dip to about 49, so a neck that stopped at the
// collar would leave a sliver of backdrop showing between the two. It meets the neckline's corners (42, 58)
// without flaring past them, so every collar wraps around it instead of tucking under it.
const NECK = 'M42.4 34 C42.6 40 42.4 44.6 41.9 47 L41.9 53 L58.1 53 L58.1 47 C57.6 44.6 57.4 40 57.6 34 Z';
const WOMAN_NECK = 'M44 34 C44.2 40 43.8 44.6 42.6 48.4 L42.6 53 L57.4 53 L57.4 48.4 C56.2 44.6 55.8 40 56 34 Z';
const LONG =
  'M42 47 C45 49.6 55 49.6 58 47 C63 47.6 68 48.6 73 50 C79.6 51.8 84.4 54.6 85.8 59.6 C86.8 63.4 87.6 70 88.6 78 L90 100 L10 100 L11.4 78 C12.4 70 13.2 63.4 14.2 59.6 C15.6 54.6 20.4 51.8 27 50 C32 48.6 37 47.6 42 47 Z';
const SHORT =
  'M42 47 C45 49.6 55 49.6 58 47 C63 47.6 68 48.6 73 50 C79.6 51.8 84.4 54.6 85.8 59.6 L86.6 66 C82 68.4 77.4 68.8 73.4 68 C74.6 78 75 88 75 100 L25 100 C25 88 25.4 78 26.6 68 C22.6 68.8 18 68.4 13.4 66 L14.2 59.6 C15.6 54.6 20.4 51.8 27 50 C32 48.6 37 47.6 42 47 Z';
const ARMS =
  'M84 64 C87.6 72 89 86 89.6 100 L76 100 C76 88 75.6 78 74.6 68 Z M16 64 C12.4 72 11 86 10.4 100 L24 100 C24 88 24.4 78 25.4 68 Z';
const SLEEVE_HEM = 'M86.6 66 C82 68.4 77.4 68.8 73.4 68 M13.4 66 C18 68.4 22.6 68.8 26.6 68';
const ARM_FOLDS =
  'M72.4 64 C73.6 74 74.6 86 75 100 L79 100 C78 86 76.4 74 72.4 64 Z M27.6 64 C26.4 74 25.4 86 25 100 L21 100 C22 86 23.6 74 27.6 64 Z';
const SHOULDER_GLOSS = 'M71 50.4 C77 52 82.4 54.6 84.4 58.4 M29 50.4 C23 52 17.6 54.6 15.6 58.4';
// the jaw's shadow on the neck, as wide as the neck (wider, it shows as grey stubs either side)
const UNDER_JAW = 'M42.6 38.6 C47 41.6 53 41.6 57.4 38.6 L57.3 41.4 C53 43.8 47 43.8 42.7 41.4 Z';
const WOMAN_UNDER_JAW = 'M44.1 38.6 C47.6 41.4 52.4 41.4 55.9 38.6 L55.95 41.4 C52.4 43.6 47.6 43.6 44.05 41.4 Z';
const LINE_FACE = 'M43.2 25.2 L48.2 24.9 M51.8 24.9 L56.8 25.2 M50 26.6 L50 31.4 L48.6 32.2'; // level brows and a nose, nothing else
// garments
const HOOD =
  'M38.2 45 C37.6 49.6 40.2 53.4 44.4 54.6 L50 51 L55.6 54.6 C59.8 53.4 62.4 49.6 61.8 45 C57.4 48.4 42.6 48.4 38.2 45 Z';
const DRAWSTRINGS = 'M47.4 52.4 L46.8 62 M52.6 52.4 L53.2 62';
const MOCK =
  'M41.4 47.4 C41.2 44.8 41.6 43 42.6 41.8 C45.6 43.2 48 43.8 50 43.8 C52 43.8 54.4 43.2 57.4 41.8 C58.4 43 58.8 44.8 58.6 47.4 C54.6 49.8 45.4 49.8 41.4 47.4 Z';
const MOCK_OPEN = 'M47.8 43.9 L50 50.4 L52.2 43.9 Z';
// the back of the polo's collar, standing up behind the neck: only its ends show, either side of it
const POLO_BAND = 'M40.4 42.6 C46 43.8 54 43.8 59.6 42.6 L59.8 48 L40.2 48 Z';
const POLO_WINGS =
  'M42.6 43.4 C41.2 45.4 40.6 48 41 50.6 L47.8 49.6 L50 52 C47.6 49.4 45.2 46.6 42.6 43.4 Z M57.4 43.4 C58.8 45.4 59.4 48 59 50.6 L52.2 49.6 L50 52 C52.4 49.4 54.8 46.6 57.4 43.4 Z';
const PLACKET = 'M48.4 51 L51.6 51 L51.6 60 L48.4 60 Z';
// a ribbed crew neck: the tee's only collar
const CREW = 'M42 47 C45 49.6 55 49.6 58 47 L59.4 47.8 C55.8 51.6 44.2 51.6 40.6 47.8 Z';
const STAND = 'M41.2 47.6 L41.4 41.4 C46.6 43 53.4 43 58.6 41.4 L58.8 47.6 C54.8 49.6 45.2 49.6 41.2 47.6 Z';
const YOKE =
  'M58 47 C63 47.6 68 48.6 73 50 C79.6 51.8 84.4 54.6 85.8 59.6 L86.4 63.4 C79 59.6 68.6 56.8 59 56.4 Z M42 47 C37 47.6 32 48.6 27 50 C20.4 51.8 15.6 54.6 14.2 59.6 L13.6 63.4 C21 59.6 31.4 56.8 41 56.4 Z';
// the shirt's collar opens as wide as the neck, so no neck shows between it and the lapels
const SHIRT = 'M41.9 46.6 L50 66 L58.1 46.6 C54.4 48.6 45.6 48.6 41.9 46.6 Z';
const SHIRT_POINTS = 'M41.9 46.6 L46.4 52 L50 49.6 Z M58.1 46.6 L53.6 52 L50 49.6 Z';
const OPEN_COLLAR = 'M45.6 47.6 L50 57 L54.4 47.6 C52.6 48.6 47.4 48.6 45.6 47.6 Z';
const TIE = 'M48.8 49.8 L51.2 49.8 L51.8 52.2 L51.4 63 L50 65.4 L48.6 63 L48.2 52.2 Z';
const LAPELS =
  'M41.9 46.6 L50 66 L46.4 71 L39.2 56.4 L42.8 54 L40.2 49.6 Z M58.1 46.6 L50 66 L53.6 71 L60.8 56.4 L57.2 54 L59.8 49.6 Z';
const VNECK = 'M43 47.4 L50 56.4 L57 47.4 C54 49 46 49 43 47.4 Z';
const POCKET = 'M56.4 57 L63.4 57 L63.4 63.4 L56.4 63.4 Z';
// headwear (the brim sits low over the eyes on purpose)
const CAP = 'M36.6 27.4 C36.2 15 42.2 8.6 50 8.6 C57.8 8.6 63.8 15 63.4 27.4 C58 26 42 26 36.6 27.4 Z';
const BRIM = 'M35.2 25.4 C39.4 22.8 60.6 22.8 64.8 25.4 C63.4 28.8 36.6 28.8 35.2 25.4 Z';
const VISOR_BAND = 'M37.4 21.2 C42 19.8 58 19.8 62.6 21.2 L62.6 23.6 C58 22.4 42 22.4 37.4 23.6 Z';
const VISOR_BRIM = 'M34.6 23 C40 20.2 60 20.2 65.4 23 C64.2 28.4 35.8 28.4 34.6 23 Z';
const BEANIE = 'M36.8 25.6 C36.2 13.2 42.2 7.2 50 7.2 C57.8 7.2 63.8 13.2 63.2 25.6 Z';
const BEANIE_CUFF = 'M36.4 20 C42 18.4 58 18.4 63.6 20 L63.8 26.6 C58 25.2 42 25.2 36.2 26.6 Z';
const RIBS =
  'M40.4 19.4 L40.4 25.8 M43.8 19 L43.8 25.4 M47.2 18.8 L47.2 25.2 M50.6 18.8 L50.6 25.2 M54 18.9 L54 25.3 M57.4 19.1 L57.4 25.5 M60.6 19.5 L60.6 26';
// gear
const BAND = 'M36.4 28.6 C35.4 15.6 41.6 8.8 50 8.8 C58.4 8.8 64.6 15.6 63.6 28.6';
const BAND_OVER_HAT = 'M36.2 28.6 C35 14.6 41.4 7 50 7 C58.6 7 65 14.6 63.8 28.6';
const CUPS =
  'M33 25.6 C33 23.8 34.2 23 35.8 23 C37.8 23 38.8 24.2 38.8 26 L38.8 32.6 C38.8 34.4 37.8 35.4 35.8 35.4 C34.2 35.4 33 34.6 33 32.8 Z M67 25.6 C67 23.8 65.8 23 64.2 23 C62.2 23 61.2 24.2 61.2 26 L61.2 32.6 C61.2 34.4 62.2 35.4 64.2 35.4 C65.8 35.4 67 34.6 67 32.8 Z';
const MIC = 'M64.6 32.6 C64.6 37.6 60 40 54.6 39.2';
const LANYARD = 'M43.6 47.6 C44.6 54 47 59.6 50 62.6 C53 59.6 55.4 54 56.4 47.6';
const BADGE = 'M45.6 62.4 L54.4 62.4 L54.4 72.4 L45.6 72.4 Z';
const STETH = 'M41.6 47.8 C38.6 54 38.8 61 43 66.4 M58.4 47.8 C61.6 54.4 61.2 62.6 56.8 68.6';
// a first-aid cross, never a red one: the Red Cross emblem is legally protected
const CHEST_CROSS =
  'M59 55.4 L61.8 55.4 L61.8 58 L64.4 58 L64.4 60.8 L61.8 60.8 L61.8 63.4 L59 63.4 L59 60.8 L56.4 60.8 L56.4 58 L59 58 Z';
// the strength coach's whistle on a cord: a mouthpiece and a round barrel, hanging mid-chest
const WHISTLE_CORD = 'M44 48 C45 53.8 47.4 58.6 50 60.8 C52.6 58.6 55 53.8 56 48';
const WHISTLE =
  'M45 60.6 L50.6 60.6 C51.1 60.3 51.6 60.2 52.2 60.2 C54 60.2 55.4 61.6 55.4 63.4 C55.4 65.2 54 66.6 52.2 66.6 C50.4 66.6 49 65.2 49 63.4 L49 62.8 L45 62.8 Z';
// hair: one solid grey shape
const HAIR_TOP =
  'M38.2 24.6 C38.4 19.8 42.6 17 48.4 17.8 L50 18.8 L51.6 17.8 C57.4 17 61.6 19.8 61.8 24.6 C62.6 14.4 57.2 9.6 50 9.6 C42.8 9.6 37.4 14.4 38.2 24.6 Z';
const HAIR_SWEPT =
  'M38.2 26 C37.8 15.4 43.2 10.2 50 10.2 C56.8 10.2 62.2 15.4 61.8 26 C59.6 20.2 54.4 17.4 46 18.8 C43 19.4 40 22 38.2 26 Z';
const BUN = 'M45.6 10.4 C45.2 7.6 47.4 6 50 6 C52.6 6 54.8 7.6 54.4 10.4 Z';
const BOB =
  'M37 24 C36.2 13 42.4 9.2 50 9.2 C57.6 9.2 63.8 13 63 24 L63.4 34.6 C62.6 36.8 60.8 37.6 58.8 37.2 L58.6 26 L41.4 26 L41.2 37.2 C39.2 37.6 37.4 36.8 36.6 34.6 Z';
const LONG_HAIR =
  'M36.2 24 C35.2 12.4 41.8 8.6 50 8.6 C58.2 8.6 64.8 12.4 63.8 24 L65.4 42 C66 46 64.4 49.6 60.6 51 L56 40.4 L44 40.4 L39.4 51 C35.6 49.6 34 46 34.6 42 Z';
const PONYTAIL =
  'M56.8 38.6 C61.4 39.4 65.6 43 66.4 49.6 C67 54 66 57.6 63.8 59.4 C63.2 55.6 62.4 51.6 60.2 47.6 C59 45.4 57.8 44 56.6 43.2 Z';

/**
 * The day's dress code for a team's staff, from the same inputs as the kit rule (`wearsWhite`), so it is a
 * pure function of the week. The offseason (and the gap after the title game) is its own look; in season
 * it follows this week's game: jackets and beanies on a cold open-air day, polos and visors on a hot one.
 * A bye, a team that's out, no team at all, a dome or a mild day leave everyone in their own outfit.
 */
export function staffDay(league: League | null, teamId: number | null): StaffDay {
  if (!league) return 'game';
  if (isOffseasonPhase(league) || league.phase === 'complete') return 'offseason';
  const g = teamId === null ? undefined : gamesInWeek(league).find((x) => x.homeId === teamId || x.awayId === teamId);
  if (!g) return 'game';
  const w = gameWeather(league, g);
  if (w.roof !== 'outdoors' && w.roof !== 'open') return 'game'; // domes and closed roofs
  return w.tempF >= HOT_KICKOFF_F ? 'hot' : w.tempF <= COLD_KICKOFF_F ? 'cold' : 'game';
}

type Person = Coach | Staff | Medic;
/** Which records a family's people are kept in: their ids are only unique within one. */
const RECORDS: Record<StaffFamily, 'coaches' | 'staff' | 'medics'> = {
  coach: 'coaches',
  strength: 'coaches',
  director: 'staff',
  scout: 'staff',
  medical: 'medics',
};

/** What `person` wears today: retired staff keep the offseason look, everyone else dresses for the week. */
export function lookOf(league: League | null, person: Person): StaffLook {
  const family = STAFF_FAMILY[person.role];
  const records = RECORDS[family];
  const retired = league !== null && !league[records][person.id];
  const day = retired ? 'offseason' : staffDay(league, person.teamId);
  return staffLook(`${records}:${person.id}`, family, 'woman' in person && person.woman === true, day);
}

/**
 * A staff member's picture slot: facing you, dressed for the job and the week, in the team's colours (or
 * the market's grey-green). Decorative: the name is always shown beside it. Never pass it ratings.
 */
export function StaffAvatar({ person, size = 32 }: { person: Person; size?: number }) {
  const league = store.get();
  const team = person.teamId !== null ? league?.teams[person.teamId] : undefined;
  const colors = team ? { primary: team.colors[0], secondary: team.colors[1] } : FREE_AGENT;
  return <StaffFigure colors={colors} look={lookOf(league, person)} size={size} />;
}

/** The drawing: a look in a team's colours. Detail (face line, zips, badges) from `DETAIL_MIN_PX`. */
export function StaffFigure({
  colors: { primary, secondary },
  look,
  size = 32,
}: {
  colors: TeamColors;
  look: StaffLook;
  size?: number;
}) {
  const { garment, headwear, gear, head, woman, hair } = look;
  const id = useId(); // unique within one React root, like PlayerAvatar
  const url = (p: string) => `url(#${id}${p})`;
  const detail = size >= DETAIL_MIN_PX;
  const heads = woman ? WOMAN_HEADS : HEADS;
  const h = heads[head % heads.length];
  const fit = `translate(50 ${h.top - 10.4}) scale(${h.half / 12.5} 1) translate(-50 0)`; // hats and hair follow the head
  const body = `translate(50 0) scale(${woman ? 0.92 : 1} 1) translate(-50 0)`; // a narrower build for women
  const cloth = garment === 'blazer' ? SUIT : garment === 'labcoat' ? COAT : primary;
  const ink = readableOn(cloth, secondary);
  const tube = contrast(cloth, PLASTIC) >= 2 ? PLASTIC : SILVER; // the stethoscope stays visible on dark clothes
  const short = garment === 'polo' || garment === 'scrubs' || garment === 'tee';
  const overEars = woman && (hair === 'bob' || hair === 'long');
  const hairBack =
    woman && (hair === 'bob' ? BOB : hair === 'long' ? LONG_HAIR : hair === 'bun' && headwear === 'none' ? BUN : null);

  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="50" cy="50" r="45" />
        </clipPath>
        <radialGradient id={`${id}bg`} cx="50" cy="38" r="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(primary, 0.82)} />
          <stop offset="1" stopColor={tint(primary, 0.5)} />
        </radialGradient>
        <radialGradient id={`${id}sk`} cx="44" cy="20" r="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(SKIN, 0.18)} />
          <stop offset="1" stopColor={shade(SKIN, 0.35)} />
        </radialGradient>
        <radialGradient id={`${id}arm`} cx="0.45" cy="0.3" r="0.75">
          <stop offset="0" stopColor={tint(SKIN, 0.16)} />
          <stop offset="1" stopColor={shade(SKIN, 0.4)} />
        </radialGradient>
        <radialGradient id={`${id}hat`} cx="44" cy="13" r="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(primary, 0.22)} />
          <stop offset="1" stopColor={shade(primary, 0.28)} />
        </radialGradient>
        <radialGradient id={`${id}hair`} cx="44" cy="12" r="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(HAIR, 0.16)} />
          <stop offset="1" stopColor={shade(HAIR, 0.3)} />
        </radialGradient>
        <linearGradient id={`${id}j`} x1="0" y1="44" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(cloth, 0.14)} />
          <stop offset="1" stopColor={shade(cloth, 0.22)} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="45" fill={url('bg')} />
      <g clipPath={url('c')}>
        {short && <path d={ARMS} fill={url('arm')} transform={body} />}
        {hairBack && <path d={hairBack} fill={url('hair')} transform={fit} />}
        {garment === 'polo' && <path d={POLO_BAND} fill={shade(cloth, 0.22)} transform={body} />}
        <path d={woman ? WOMAN_NECK : NECK} fill={url('sk')} />
        <path d={woman ? WOMAN_UNDER_JAW : UNDER_JAW} fill="#000" fillOpacity={0.16} />
        {!overEars && <path d={h.ears} fill={url('sk')} />}
        <path d={h.d} fill={url('sk')} />
        {detail && (
          <path
            d={LINE_FACE}
            stroke={shade(SKIN, 0.5)}
            strokeWidth={1.4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {woman && <path d={hair === 'bob' ? HAIR_SWEPT : HAIR_TOP} fill={url('hair')} transform={fit} />}

        <g transform={body}>
          <path d={short ? SHORT : LONG} fill={url('j')} {...EDGE} />
          {short ? (
            <path d={SLEEVE_HEM} stroke="#000" strokeOpacity={0.25} strokeWidth={1.1} fill="none" />
          ) : (
            <path d={ARM_FOLDS} fill="#000" fillOpacity={0.14} />
          )}
          <path d={SHOULDER_GLOSS} {...GLOSS} />

          {garment === 'hoodie' && (
            <>
              <path d={HOOD} fill={shade(cloth, 0.1)} {...EDGE} />
              {/* a whistle's cord takes the drawstrings' place: both together tangle into a knot */}
              {detail && gear !== 'whistle' && (
                <path d={DRAWSTRINGS} stroke={ink} strokeWidth={1.2} strokeLinecap="round" />
              )}
            </>
          )}
          {garment === 'quarterzip' && (
            <>
              <path d={MOCK} fill={shade(cloth, 0.12)} {...EDGE} />
              <path d={MOCK_OPEN} fill={url('sk')} />
              {detail && <path d="M50 50.4 L50 62" stroke={shade(cloth, 0.45)} strokeWidth={1} />}
              {detail && <rect x="48.9" y="50.4" width="2.2" height="3.8" rx="0.8" fill={ink} />}
            </>
          )}
          {garment === 'polo' && (
            <>
              <path d={POLO_WINGS} fill={shade(cloth, 0.08)} {...EDGE} />
              {detail && <path d={PLACKET} fill={shade(cloth, 0.06)} {...EDGE} />}
              {detail && (
                <>
                  <circle cx="50" cy="54" r="0.9" fill={ink} />
                  <circle cx="50" cy="57.4" r="0.9" fill={ink} />
                </>
              )}
            </>
          )}
          {garment === 'tee' && <path d={CREW} fill={shade(cloth, 0.2)} {...EDGE} />}
          {garment === 'jacket' && (
            <>
              <path d={YOKE} fill={shade(primary, 0.35)} />
              <path d={STAND} fill={shade(cloth, 0.15)} {...EDGE} />
              {detail && <path d="M50 43 L50 100" stroke={ink} strokeWidth={1.1} />}
            </>
          )}
          {garment === 'blazer' && (
            <>
              <path d={SHIRT} fill="#E5E9EF" />
              {woman && <path d={OPEN_COLLAR} fill={url('sk')} />}
              <path d={SHIRT_POINTS} fill="#F8FAFC" {...EDGE} />
              {!woman && <path d={TIE} fill={primary} {...EDGE} />}
              <path d={LAPELS} fill={shade(SUIT, 0.25)} {...EDGE} />
            </>
          )}
          {garment === 'labcoat' && (
            <>
              <path d={SHIRT} fill={primary} />
              <path d={LAPELS} fill={tint(COAT, 0.4)} {...EDGE} />
            </>
          )}
          {garment === 'scrubs' && (
            <>
              <path d={VNECK} fill={url('sk')} />
              <path d="M43 47.4 L50 56.4 L57 47.4" stroke={shade(cloth, 0.3)} strokeWidth={1.4} fill="none" />
              {detail && <path d={POCKET} fill="none" stroke={shade(cloth, 0.3)} strokeWidth={0.9} />}
            </>
          )}

          {gear === 'credential' && detail && (
            <>
              <path d={LANYARD} stroke={garment === 'blazer' ? primary : ink} strokeWidth={1.2} fill="none" />
              <path d={BADGE} fill="#F8FAFC" {...EDGE} />
              <path d="M47 65 L53 65 M47 67.4 L52 67.4" stroke="#94A3B8" strokeWidth={0.9} />
            </>
          )}
          {gear === 'stethoscope' && detail && (
            <>
              <path d={STETH} stroke={tube} strokeWidth={1.6} fill="none" strokeLinecap="round" />
              <circle cx="56.6" cy="69.6" r="2.4" fill={SILVER} stroke={PLASTIC} strokeWidth={0.8} />
            </>
          )}
          {gear === 'cross' && detail && <path d={CHEST_CROSS} fill={ink} />}
          {gear === 'whistle' && detail && (
            <>
              <path d={WHISTLE_CORD} stroke={ink} strokeWidth={1} fill="none" />
              <path d={WHISTLE} fill={SILVER} stroke={PLASTIC} strokeWidth={0.7} strokeLinejoin="round" />
              <circle cx="52.2" cy="63.4" r="1" fill={PLASTIC} fillOpacity={0.55} />
            </>
          )}
        </g>
        {woman && hair === 'ponytail' && <path d={PONYTAIL} fill={url('hair')} />}

        <g transform={fit}>
          {headwear === 'cap' && (
            <>
              <path d={CAP} fill={url('hat')} {...EDGE} />
              <path d={BRIM} fill={shade(primary, 0.3)} {...EDGE} />
            </>
          )}
          {headwear === 'visor' && (
            <>
              <path d={VISOR_BAND} fill={shade(primary, 0.15)} {...EDGE} />
              <path d={VISOR_BRIM} fill={shade(primary, 0.3)} {...EDGE} />
            </>
          )}
          {headwear === 'beanie' && (
            <>
              <path d={BEANIE} fill={url('hat')} {...EDGE} />
              <path d={BEANIE_CUFF} fill={shade(primary, 0.18)} {...EDGE} />
              {detail && <path d={RIBS} stroke="#000" strokeOpacity={0.12} strokeWidth={0.7} />}
            </>
          )}
          {gear === 'headset' && (
            <>
              <path d={CUPS} fill={PLASTIC} />
              <path
                d={headwear === 'cap' || headwear === 'beanie' ? BAND_OVER_HAT : BAND}
                stroke={PLASTIC}
                strokeWidth={2.6}
                fill="none"
              />
              {detail && <path d={MIC} stroke={PLASTIC} strokeWidth={1.4} fill="none" strokeLinecap="round" />}
              {detail && <circle cx="54.2" cy="39.2" r="1.7" fill={PLASTIC} />}
            </>
          )}
        </g>
      </g>
      <circle cx="50" cy="50" r="46.5" fill="none" stroke={shade(primary, 0.35)} strokeWidth={5} />
      <circle cx="50" cy="50" r="43.6" fill="none" stroke={tint(primary, 0.45)} strokeWidth={0.6} strokeOpacity={0.8} />
    </svg>
  );
}
