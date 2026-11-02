import { gamesInWeek } from '../engine/league';
import type {
  ClubUniforms,
  Game,
  HelmetDesign,
  League,
  NumberFont,
  SleeveStyle,
  Team,
  UniformSet,
} from '../engine/types';
import { gameWeather } from '../engine/weather';
import { contrast, kitFor, numberOutline, readableOn, shade, type Kit } from './color';
import { helmetDesignOf } from './helmet';

export { numberOutline };

// What a club wears on a given day (`docs/AVATARS.md`): its home or away kit by the league's rule, or the special set
// the schedule stamped on its home game (`Game.uniform`: a colour rush, a blackout or a classic), and with it the
// sleeve stripes, the number font and the helmet. The designs are data (`engine/data/uniforms.ts`); a mod's club is
// dressed from its colours. Nothing in the sim reads any of it.

/** Kickoff this hot in the open air, the home team takes white and leaves the visitors the dark jerseys (tune). */
export const HOT_KICKOFF_F = 85;

/**
 * Whether a team takes the field in white by the plain kit rule: the home team picks, the visitors wear the other
 * jersey. Home teams wear their colours, except on a hot open-air day (Miami, Tampa and Jacksonville in September,
 * mostly), about one game in fifty. It follows this week's game, or `game` for one already played (weather is a pure
 * function of the game, so it comes out the same); with no game (a bye, the offseason) everyone is in home colours.
 */
export function wearsWhite(league: League | null, teamId: number, game?: Game): boolean {
  const g = gameOf(league, teamId, game);
  if (!league || !g) return false;
  const w = gameWeather(league, g);
  const homeInWhite = (w.roof === 'outdoors' || w.roof === 'open') && w.tempF >= HOT_KICKOFF_F;
  return (g.homeId === teamId) === homeInWhite;
}

/** `game`, or the team's game this week in season; undefined in a bye, the offseason or with no league. */
function gameOf(league: League | null, teamId: number, game?: Game): Game | undefined {
  const inSeason = league?.phase === 'regular' || league?.phase === 'playoffs';
  const g =
    game ??
    (league && inSeason ? gamesInWeek(league).find((x) => x.homeId === teamId || x.awayId === teamId) : undefined);
  return g && (g.homeId === teamId || g.awayId === teamId) ? g : undefined;
}

/** Each number font's face, how much wider it's drawn and its size (the tall face runs a little smaller). */
export const NUMBER_FONTS: Record<NumberFont, { family: string; stretch: number; scale: number }> = {
  standard: { family: 'var(--font-display)', stretch: 1.15, scale: 1 },
  tall: { family: "'Anton', 'Arial Narrow', sans-serif", stretch: 1.25, scale: 0.91 },
  wide: { family: "'Archivo Black', 'Arial Black', sans-serif", stretch: 0.85, scale: 1 },
  squared: { family: "'Russo One', 'Arial Black', sans-serif", stretch: 0.85, scale: 1 },
  slab: { family: "'Bitter', Georgia, serif", stretch: 0.95, scale: 1 },
};

const WHITE = '#F2F4F6';
const CREAM = '#EDE6D6';
/**
 * A club's special uniforms: its data, or for a club without any (a mod's) a colour rush and a classic built from its
 * colours by the same rules (no blackout, today's numbers).
 */
export function clubUniforms(team: Pick<Team, 'colors' | 'helmet' | 'uniforms'>): ClubUniforms {
  if (team.uniforms) return team.uniforms;
  const [p, s] = team.colors;
  return {
    font: 'standard',
    rush: { jersey: p, pants: p, ink: readableOn(p, s), sleeves: 'wide', accent: WHITE, pantsStripe: WHITE },
    classic: {
      jersey: p,
      pants: CREAM,
      ink: readableOn(p, WHITE),
      sleeves: 'three',
      accent: s,
      pantsStripe: p,
      helmet: { ...helmetDesignOf(team), finish: 'matte' },
    },
  };
}

export interface Dressed {
  set: 'home' | 'away' | 'rush' | 'blackout' | 'classic';
  kit: Kit;
  sleeves: SleeveStyle;
  font: NumberFont;
  helmet: HelmetDesign;
}

/** A special set's kit: its colours, and its number outline as designed or by the rule. */
function kitOf(set: UniformSet, secondary: string): Kit {
  const o = set.outline ?? numberOutline(set.jersey, set.ink, secondary);
  return {
    jersey: set.jersey,
    ink: set.ink,
    trim: o.color,
    outline: o.width,
    accent: set.accent,
    pants: set.pants,
    stripe: set.pantsStripe,
    stripeThin: set.pantsStripe,
    belt: shade(set.pants, 0.35),
  };
}
const special = (u: ClubUniforms, name: NonNullable<Game['uniform']>) =>
  name === 'blackout' ? (u.blackout ?? u.rush) : name === 'classic' ? u.classic : u.rush;
/** A jersey light enough that the visitors can't wear white against it. */
const light = (jersey: string) => contrast(jersey, '#FFFFFF') < 1.5;

/**
 * What `team` wears: in a game the schedule stamped, the home team its special set (it beats the hot-day white) and the
 * visitors white, or their colours against a whiteout; otherwise the plain kit by `wearsWhite`. In this week's game,
 * or `game` for one already played.
 */
export function uniformFor(league: League | null, team: Team, game?: Game): Dressed {
  const u = clubUniforms(team);
  const colors = { primary: team.colors[0], secondary: team.colors[1] };
  const g = gameOf(league, team.id, game);
  const plain = (away: boolean): Dressed => ({
    set: away ? 'away' : 'home',
    kit: kitFor(colors, away),
    sleeves: 'two',
    font: u.font,
    helmet: helmetDesignOf(team),
  });
  if (g?.uniform && !g.playoffRound) {
    if (g.homeId === team.id) {
      const set = special(u, g.uniform);
      return {
        set: g.uniform === 'blackout' && !u.blackout ? 'rush' : g.uniform,
        kit: kitOf(set, colors.secondary),
        sleeves: set.sleeves,
        font: g.uniform === 'classic' ? 'slab' : u.font,
        helmet: set.helmet ?? helmetDesignOf(team),
      };
    }
    // the visitors need the home club's set to know whether it's a whiteout
    const homeTeam = league?.teams[g.homeId];
    if (homeTeam) return plain(!light(special(clubUniforms(homeTeam), g.uniform).jersey));
  }
  return plain(wearsWhite(league, team.id, g));
}
