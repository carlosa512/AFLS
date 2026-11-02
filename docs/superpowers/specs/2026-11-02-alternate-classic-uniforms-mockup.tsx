/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Reference only, not built (outside tsconfig's `include`): the mockup source behind
 * `2026-11-02-alternate-classic-uniforms-design.md` as of round 6 (round 7 only sized the tall font: 91%). It holds
 * the colour rush, blackout and classic rules (`rushOf`, `RUSH`, `blackoutOf`, `alternateOf`, `classicOf`,
 * `CLASSIC_HELMET`, `CLASSIC_JERSEY`), the number outline rule (`outlined`), the fonts per club (`FONT_OF`) and the
 * sleeve styles (`SleeveStripes`). Rebuild the page from the repo root:
 *   npx tsx docs/superpowers/specs/2026-11-02-alternate-classic-uniforms-mockup.tsx out.html
 */
// Throwaway: alternate and classic uniform mockups on the real avatar (PlayerAvatar copied with overrides). Not game code.
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Game, HelmetDesign, Player, Team } from '../../../src/engine/types';
import { contrast, kitFor, mix, readableOn, shade, tint, type Kit } from '../../../src/ui/color';
import { DECALS_MIN_PX, FREE_AGENT, SKIN, wearsWhite } from '../../../src/ui/components';
import { GearLayer } from '../../../src/ui/gearArt';
import { coldGame, gearOf } from '../../../src/ui/playerGear';
import { BUILD_MIN_PX, buildOf, playerLook, type Figure } from '../../../src/ui/playerLook';
import { flagsOf, greenDotOf, helmetDesignOf, helmetModelOf, maskOf, wearsHelmet } from '../../../src/ui/helmet';
import { HelmetLayer, helmetTransform, MaskLayer } from '../../../src/ui/helmetArt';
import { store } from '../../../src/ui/store';
import { TEAM_SEEDS } from '../../../src/engine/data/teams';

const NUMBER_MIN_PX = 32;
const NAMEPLATE_MIN_PX = 96;
const PLATE_EM = 0.52;
let uid = 0;
type SleeveStyle = 'two' | 'none' | 'three' | 'wide';
/** The sleeve stripes on the pads' outer face: today's two, none, three thin (classic), one wide. */
function SleeveStripes({ f, style, ink, accent }: { f: Figure; style: SleeveStyle; ink: string; accent: string }) {
  if (style === 'none') return null;
  if (style === 'two')
    return (
      <>
        <path d={f.bandsUpper} stroke={ink} strokeWidth={2} fill="none" />
        <path d={f.bandsLower} stroke={accent} strokeWidth={2} fill="none" />
      </>
    );
  if (style === 'three')
    return (
      <>
        <path d={f.bandsUpper} transform="translate(0 -1.2)" stroke={ink} strokeWidth={1.2} fill="none" />
        <path d={f.bandsUpper} transform="translate(0 1.5)" stroke={accent} strokeWidth={1.2} fill="none" />
        <path d={f.bandsLower} transform="translate(0 1.6)" stroke={ink} strokeWidth={1.2} fill="none" />
      </>
    );
  return (
    <>
      <path d={f.bandsUpper} transform="translate(0 1.6)" stroke={ink} strokeWidth={4} fill="none" />
      <path d={f.bandsUpper} transform="translate(0 1.6)" stroke={accent} strokeWidth={2.4} fill="none" />
    </>
  );
}
export function MockAvatar({
  player,
  team,
  size = 32,
  game,
  kitOver,
  design,
  sleeves = 'two',
  font,
  stretch = 1.15,
  outline = 1.4,
  outer,
}: {
  player: Player;
  team: Team | null;
  size?: number;
  game?: Game;
  kitOver?: Kit;
  design?: HelmetDesign;
  sleeves?: SleeveStyle;
  font?: string;
  stretch?: number;
  /** The number's outline width, and an optional second, outer outline's colour. */
  outline?: number;
  outer?: string;
}) {
  const id = `m${uid++}`;
  if (player.portrait) {
    return <img className="avatar" src={player.portrait} alt="" width={size} height={size} loading="lazy" />;
  }
  const url = (part: string) => `url(#${id}${part})`;
  const colors = team ? { primary: team.colors[0], secondary: team.colors[1] } : FREE_AGENT;
  const { primary } = colors;
  const kit = kitOver ?? kitFor(colors, team !== null && wearsWhite(store.get(), team.id, game));
  const { jersey, ink, trim, accent } = kit;
  const look = playerLook(player, size);
  const { figure: f, head, transform } = look;
  // his gear from 32px, like his build: sleeves in a cold game follow the kit's game
  const gear = size >= BUILD_MIN_PX ? gearOf(player, team !== null && coldGame(store.get(), team.id, game)) : null;
  // his club's helmet (free agents, prospects and retired players go bareheaded): the shell at every size, its details
  // from 32px like his gear, its decals from 56px
  const helmet =
    team && wearsHelmet(player, team)
      ? (() => {
          const model = helmetModelOf(player);
          const league = store.get();
          return {
            model,
            design: design ?? helmetDesignOf(team),
            place: helmetTransform(model, look.build ? buildOf(player.weightLb).traps : null),
            decals:
              size >= DECALS_MIN_PX
                ? { flags: flagsOf(player), dot: league !== null && greenDotOf(league, team, player) }
                : null,
          };
        })()
      : null;
  const plate = player.lastName.toUpperCase();
  // long names shrink, and textLength holds the estimate even if the font hasn't loaded and a wider one stands in
  const plateSize = Math.min(9.5, f.plateMax / (plate.length * PLATE_EM));
  // 15% wider around x = 50 (the condensed display face is narrower than block jersey numerals), less on a narrow back
  const numberX = stretch * f.numberWidth;
  return (
    <svg
      className="avatar"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fontFamily={font ?? 'var(--font-display)'}
      aria-hidden="true"
    >
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
        <linearGradient id={`${id}j`} x1="0" y1="44" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(jersey, 0.14)} />
          <stop offset="1" stopColor={shade(jersey, 0.22)} />
        </linearGradient>
        {f.pants && (
          // the pants' sheen: light over each side of the seat, darker at the seam and where they turn away
          <linearGradient
            id={`${id}p`}
            x1={50 - f.pants.halfWidth}
            y1="0"
            x2={50 + f.pants.halfWidth}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={shade(kit.pants, 0.32)} />
            <stop offset="0.24" stopColor={tint(kit.pants, 0.12)} />
            <stop offset="0.5" stopColor={shade(kit.pants, 0.16)} />
            <stop offset="0.76" stopColor={tint(kit.pants, 0.12)} />
            <stop offset="1" stopColor={shade(kit.pants, 0.32)} />
          </linearGradient>
        )}
      </defs>
      <circle cx="50" cy="50" r="45" fill={url('bg')} />
      <g clipPath={url('c')}>
        <g transform={transform}>
          <path d={f.armL} fill={url('arm')} />
          <path d={f.armR} fill={url('arm')} />
          {gear && <GearLayer id={id} figure={f} gear={gear} colors={colors} />}
          {helmet && (
            <g transform={helmet.place}>
              <MaskLayer model={helmet.model} mask={maskOf(player.position)} color={helmet.design.mask} />
            </g>
          )}
          <path d={f.neck} fill={url('sk')} />
          <path d={f.neckSides} fill="#000" fillOpacity={0.08} />
          <path d={f.neckShade} fill="#000" fillOpacity={0.16} />
          {!helmet && (
            <>
              <path d={head.ears} fill={url('sk')} />
              <path d={head.d} fill={url('sk')} />
            </>
          )}
          {/* a soft outline keeps a white jersey off a pale backdrop */}
          <path
            d={f.jersey}
            fill={url('j')}
            stroke="#0F172A"
            strokeOpacity={0.35}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {/* the head's shadow below the collar, the pad shelf, the folds where the body turns away, gloss on the pads */}
          <ellipse cx="50" cy={f.shadow.cy} rx={f.shadow.rx} ry="2.4" fill="#000" fillOpacity={0.16} />
          <path d={f.padShelf} fill="#000" fillOpacity={0.1} />
          <path d={f.folds} fill="#000" fillOpacity={0.14} />
          {f.pants && (
            <>
              <path
                d={f.pants.pants}
                fill={url('p')}
                stroke="#0F172A"
                strokeOpacity={0.35}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <path d={f.pants.stripes} fill={kit.stripe} />
              <path d={f.pants.stripesThin} fill={kit.stripeThin} />
              <path d={f.pants.seam} stroke="#000" strokeOpacity={0.18} strokeWidth={0.6} />
              <path d={f.pants.belt} fill={kit.belt} />
              <path d={f.pants.tuck} fill={url('j')} />
              <path d={f.pants.tuck} fill="#000" fillOpacity={0.12} />
            </>
          )}
          <path
            d={f.padGloss}
            stroke="#FFFFFF"
            strokeOpacity={0.35}
            strokeWidth={1.3}
            strokeLinecap="round"
            fill="none"
          />
          <path d={f.sleeveShadow} fill="#000" fillOpacity={0.28} />
          <path d={f.collar} stroke={ink} strokeWidth={2.4} fill="none" />
          {helmet && (
            <g transform={helmet.place}>
              <HelmetLayer
                id={`${id}h`}
                model={helmet.model}
                design={helmet.design}
                number={player.jersey}
                detail={size >= BUILD_MIN_PX}
                decals={helmet.decals}
              />
            </g>
          )}
          {size >= NUMBER_MIN_PX && (
            <>
              <SleeveStripes f={f} style={sleeves} ink={ink} accent={accent} />
              {outer && (
                <text
                  x="50"
                  y="78"
                  transform={`translate(${+(50 * (1 - numberX)).toFixed(2)} 0) scale(${+numberX.toFixed(3)} 1)`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={32}
                  fontWeight={900}
                  fill={outer}
                  stroke={outer}
                  strokeWidth={outline + 2.2}
                  strokeLinejoin="round"
                >
                  {player.jersey}
                </text>
              )}
              <text
                x="50"
                y="78"
                transform={`translate(${+(50 * (1 - numberX)).toFixed(2)} 0) scale(${+numberX.toFixed(3)} 1)`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={32}
                fontWeight={900}
                fill={ink}
                stroke={trim}
                strokeWidth={outline}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {player.jersey}
              </text>
            </>
          )}
          {size >= NAMEPLATE_MIN_PX && (
            <text
              x="50"
              y="56.2"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={plateSize}
              fontWeight={800}
              letterSpacing={0.3}
              fill={ink}
              textLength={plate.length * PLATE_EM * plateSize}
              lengthAdjust="spacingAndGlyphs"
            >
              {plate}
            </text>
          )}
        </g>
      </g>
      <circle cx="50" cy="50" r="46.5" fill="none" stroke={shade(primary, 0.35)} strokeWidth={5} />
      <circle cx="50" cy="50" r="43.6" fill="none" stroke={tint(primary, 0.45)} strokeWidth={0.6} strokeOpacity={0.8} />
    </svg>
  );
}

const svg = (p: Parameters<typeof MockAvatar>[0]) => renderToStaticMarkup(<MockAvatar {...p} />);

const seed = (abbrev: string) => TEAM_SEEDS.find((s) => s.abbrev === abbrev)!;
const teamOf = (abbrev: string, id: number) =>
  ({ id, colors: seed(abbrev).colors, helmet: seed(abbrev).helmet }) as unknown as Team;
const CREAM = '#EDE6D6';
const BLACK = '#1b1d22';
const WHITE = '#F2F4F6';
/** A kit from its parts: the number in `ink` (made readable), trimmed and banded like today's. */
function kit(jersey: string, inkPref: string, accent: string, pants: string, stripe: string): Kit {
  const ink = readableOn(jersey, inkPref);
  return {
    jersey,
    ink,
    trim: shade(jersey, 0.45),
    accent,
    pants,
    stripe,
    stripeThin: stripe,
    belt: shade(pants, 0.35),
  };
}
const plainHelmet = (shell: string, stripe: string | undefined, mask: string, bumper: string): HelmetDesign => ({
  shell,
  finish: 'gloss',
  stripe: stripe ? 'single' : 'none',
  ...(stripe ? { stripeA: stripe } : {}),
  bumper,
  mask,
});

type Style = {
  tag: string;
  kind: 'Alternate' | 'Classic' | 'Home';
  name: string;
  note: string;
  make: (p: string, s: string, abbrev: string) => { kit?: Kit; design?: HelmetDesign; sleeves?: SleeveStyle };
};
const STYLE = String.raw`<style>
/* Layout: the app's press-box console; one row per uniform style, one column per club. Tokens from src/styles.css. */
:root { --bg: #eff2ee; --surface: #ffffff; --surface-2: #e5eae4; --ink: #121915; --muted: #5a675f; --line: #d3dbd3; --marker: #ffcf1f; --marker-ink: #251e00;
  --font-display: 'Big Shoulders Display', 'Arial Narrow', sans-serif; --font-body: 'Atkinson Hyperlegible', system-ui, sans-serif; --font-data: 'IBM Plex Mono', ui-monospace, monospace; --radius: 10px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1210; --surface: #141b17; --surface-2: #1b241f; --ink: #e5ebe6; --muted: #93a198; --line: #29342e; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #0d1210; --surface: #141b17; --surface-2: #1b241f; --ink: #e5ebe6; --muted: #93a198; --line: #29342e; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 400 15px/1.5 var(--font-body); }
main { max-width: 1180px; margin: 0 auto; padding-block: 28px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 16px; }
h1, h2 { font-family: var(--font-display); font-weight: 900; text-transform: uppercase; margin: 0; line-height: 1.05; text-wrap: balance; }
h1 { font-size: 2.6rem; } h2 { font-size: 1.6rem; }
p { margin: 0; max-width: 70ch; }
.lede { display: grid; gap: 10px; margin-bottom: 8px; } .lede p, .rowhead p { color: var(--muted); }
.eyebrow { font: 600 0.75rem/1 var(--font-data); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.row { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; display: grid; grid-template-columns: minmax(0, 230px) minmax(0, 1fr); gap: 16px; align-items: center; }
.row.home { background: var(--surface-2); }
@media (max-width: 860px) { .row { grid-template-columns: minmax(0, 1fr); } }
.rowhead { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: baseline; }
.rowhead p { grid-column: 1 / -1; font-size: 0.9rem; }
.kind { grid-column: 1 / -1; font: 600 0.7rem/1 var(--font-data); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.tag { font: 600 0.8rem/1 var(--font-data); background: var(--surface-2); padding: 4px 6px; border-radius: 4px; }
.cells { display: flex; gap: 10px; flex-wrap: wrap; }
.cell { display: grid; gap: 4px; justify-items: center; } .cell svg { display: block; }
.cell span { font: 400 0.7rem/1 var(--font-data); color: var(--muted); }
.sub { color: var(--muted); }
.ask { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; display: grid; gap: 10px; }
.ask ol { margin: 0; padding-left: 1.3em; display: grid; gap: 6px; }
</style>`;

type Look = { kit?: Kit; design?: HelmetDesign; sleeves?: SleeveStyle };
const P = (id: number, jersey: number, lastName: string, position = 'QB', weightLb = 225) =>
  ({ id, firstName: 'A', lastName, jersey, position, heightIn: 75, weightLb, gear: {} }) as unknown as Player;
const DIVS: [string, string[]][] = [
  ['Liberty East', ['BUF', 'MIA', 'NE', 'NYK']],
  ['Liberty North', ['BAL', 'CIN', 'CLE', 'PIT']],
  ['Liberty South', ['HOU', 'IND', 'JAX', 'TEN']],
  ['Liberty West', ['DEN', 'KC', 'LV', 'LAC']],
  ['Frontier East', ['DAL', 'NYE', 'PHI', 'WAS']],
  ['Frontier North', ['CHI', 'DET', 'GB', 'MIN']],
  ['Frontier South', ['ATL', 'CAR', 'NO', 'TB']],
  ['Frontier West', ['ARI', 'LAS', 'SF', 'SEA']],
];
const BLACKOUT = new Set(['PIT', 'CHI', 'LV', 'NO', 'HOU', 'ATL', 'CAR', 'ARI']);
const GREY = '#9AA3AD';
const tri = (
  shell: string,
  a: string,
  b: string,
  num: [string, string] | null,
  bumper: string,
  mask: string,
): HelmetDesign => ({
  shell,
  finish: 'matte',
  stripe: 'triple',
  stripeA: a,
  stripeB: b,
  ...(num ? { number: { ink: num[0], trim: num[1] } } : {}),
  bumper,
  mask,
});
// the classic helmets in another colour (colours only: our own designs, never a real club's throwback)
const CLASSIC_HELMET: Record<string, HelmetDesign> = {
  SEA: tri('#a5acaf', '#002244', '#69be28', ['#002244', WHITE], '#002244', '#002244'),
  DEN: tri('#fb4f14', '#002244', WHITE, ['#002244', WHITE], '#002244', GREY),
  TEN: tri('#4b92db', '#0c2340', WHITE, ['#0c2340', WHITE], '#0c2340', GREY),
  PHI: tri('#1f7a3a', '#c4ccd0', WHITE, ['#ffffff', '#0f3d1d'], '#c4ccd0', GREY),
  ATL: tri('#a71930', '#000000', WHITE, ['#ffffff', '#000000'], '#000000', GREY),
  BUF: tri('#c60c30', '#00338d', WHITE, ['#ffffff', '#00338d'], '#00338d', GREY),
  NE: tri(WHITE, '#c60c30', '#002244', ['#c60c30', WHITE], '#c60c30', GREY),
  NYK: tri(WHITE, '#125740', '#125740', ['#125740', WHITE], '#125740', GREY),
  LAC: tri(WHITE, '#0080c6', '#ffc20e', ['#0080c6', WHITE], '#0080c6', GREY),
  DAL: tri(WHITE, '#003594', '#003594', ['#003594', WHITE], '#003594', GREY),
  TB: tri(WHITE, '#d50a0a', '#34302b', ['#d50a0a', WHITE], '#d50a0a', GREY),
};
// a few classics change the jersey colour with the helmet
const CLASSIC_JERSEY: Record<string, string> = { TEN: '#4b92db', PHI: '#1f7a3a' };

const alternateOf = (ab: string): Look & { label: string } => {
  const [p, s] = seed(ab).colors;
  if (BLACKOUT.has(ab)) {
    const t = contrast(p, '#000000') < 1.4 ? s : p;
    return {
      label: 'Blackout',
      kit: kit(BLACK, t, t, BLACK, t),
      sleeves: 'two',
      design: {
        ...plainHelmet(BLACK, t, BLACK, t),
        stripe: 'triple',
        stripeA: t,
        stripeB: WHITE,
        number: { ink: t, trim: BLACK },
      },
    };
  }
  return { label: 'Colour rush', kit: kit(p, s, WHITE, p, WHITE), sleeves: 'wide' };
};
const classicOf = (ab: string): Look & { label: string } => {
  const [p, s] = seed(ab).colors;
  const jersey = CLASSIC_JERSEY[ab] ?? p;
  const helmet = CLASSIC_HELMET[ab] ?? { ...seed(ab).helmet!, finish: 'matte' as const };
  return {
    label: CLASSIC_HELMET[ab] ? 'Classic · own colour' : 'Classic',
    kit: kit(jersey, WHITE, s, CREAM, jersey),
    sleeves: 'three',
    design: helmet,
  };
};

const POS = ['QB', 'WR', 'LB', 'OL', 'CB', 'RB', 'EDGE', 'TE'];
const NAMES =
  'Caldwell Okafor Brandt Kowalczyk Pierre Hale Lindqvist Ivory Achebe Ruiz Haldorsen Okoye Brandvold Mercer Delacroix Tanaka Abernathy Whitlock Moreau Petrakis Osei Vance Ferreira Nakamura Holloway Mbeki Larsen Quintero Sorensen Adeyemi Castellano Rourke'.split(
    ' ',
  );
const W: Record<string, number> = { QB: 225, WR: 196, LB: 242, OL: 316, CB: 190, RB: 214, EDGE: 266, TE: 252 };
const pl = (i: number) => {
  const pos = POS[i % 8];
  return P(700 + i, [12, 81, 54, 71, 24, 28, 91, 87][i % 8], NAMES[i % NAMES.length], pos, W[pos]);
};
type Num = { font?: string; stretch?: number; outline?: number; outer?: string };
const one = (ab: string, i: number, look: Look & Num, label: string, size = 104) =>
  `<div class="cell">${svg({ player: pl(i), team: teamOf(ab, i), size, kitOver: look.kit, design: look.design, sleeves: look.sleeves ?? 'two', font: look.font, stretch: look.stretch, outline: look.outline, outer: look.outer })}<span>${label}</span></div>`;

/** A kit set by hand: number ink and its outline as given. */
const kitBy = (jersey: string, ink: string, trim: string, accent: string, pants: string, stripe: string): Kit => ({
  jersey,
  ink,
  trim,
  accent,
  pants,
  stripe,
  stripeThin: stripe,
  belt: shade(pants, 0.35),
});
const WHITE_OUT = (ink: string, trim: string, accent: string): Look => ({
  kit: kitBy(WHITE, ink, trim, accent, WHITE, accent),
  sleeves: 'wide',
});
/** Colour rushes as the owner set them (round 5); every other club's is round 3's. */
const RUSH: Record<string, Look> = {
  LV: WHITE_OUT('#000000', '#a5acaf', '#000000'),
  PIT: WHITE_OUT('#101820', '#ffb612', '#ffb612'),
  NO: WHITE_OUT('#d3bc8d', '#101820', '#101820'),
  HOU: { kit: kitBy('#a71930', WHITE, '#03202f', WHITE, '#a71930', WHITE), sleeves: 'wide' },
  ATL: { kit: kitBy('#a71930', '#000000', WHITE, WHITE, '#a71930', WHITE), sleeves: 'wide' },
  CAR: { ...WHITE_OUT('#101820', '#0085ca', '#0085ca'), outline: 2.4 },
  ARI: WHITE_OUT('#97233f', '#000000', '#97233f'),
  CHI: { kit: kit('#c83803', BLACK, WHITE, '#c83803', WHITE), sleeves: 'wide' },
};
const rushOf = (ab: string): Look =>
  RUSH[ab] ?? { kit: kit(seed(ab).colors[0], seed(ab).colors[1], WHITE, seed(ab).colors[0], WHITE), sleeves: 'wide' };
const blackoutOf = (ab: string): Look => {
  const b = alternateOf(ab);
  // Arizona's blackout: red numbers, outlined in white so they read on black
  if (ab === 'ARI') return { ...b, kit: { ...b.kit!, ink: '#97233f', trim: WHITE }, outline: 2.4 } as Look;
  return b;
};

// classics in heavy slab, outlined in the second colour where it reads (or for flavour), otherwise a dark edge
const SLAB = "'Alfa Slab One', serif";
const classicNum = (ab: string): Num => {
  const [, s] = seed(ab).colors;
  const k = classicOf(ab).kit!;
  const flavour = contrast(s, k.jersey) >= 1.6 && contrast(s, k.ink) >= 1.6;
  return {
    font: SLAB,
    stretch: 0.8,
    outline: flavour ? 2.2 : 1.6,
    ...(flavour ? {} : {}),
    ...(flavour ? { outer: undefined } : {}),
  };
};
const classicLook = (ab: string): Look & Num => {
  const c = classicOf(ab);
  const [, s] = seed(ab).colors;
  const flavour = contrast(s, c.kit!.jersey) >= 1.6 && contrast(s, c.kit!.ink) >= 1.6;
  return { ...c, kit: { ...c.kit!, trim: flavour ? s : shade(c.kit!.jersey, 0.5) }, ...classicNum(ab) };
};

/** Every number outlined: in the second colour where it stands off the jersey and the number (O2), else an edge. */
const outlined = (k: Kit, s: string): { trim: string; outline: number } => {
  if (contrast(s, k.jersey) >= 1.5 && contrast(s, k.ink) >= 1.5) return { trim: s, outline: 2.4 };
  const dark = '#0F172A';
  const light = '#F8FAFC';
  return { trim: contrast(k.ink, dark) >= contrast(k.ink, light) ? dark : light, outline: 2 };
};
const withOutline = (look: Look & Num, ab: string): Look & Num => {
  if (!look.kit) return look;
  if (look.outline) return look; // set by hand
  const o = outlined(look.kit, seed(ab).colors[1]);
  return { ...look, kit: { ...look.kit, trim: o.trim }, outline: o.outline };
};
// the proposed fonts per club: N1 tall condensed, N2 wide grotesk, N3 squared tech for Seattle; the rest today's
const N1 = { font: "'Anton', sans-serif", stretch: 1.25 };
const N2 = { font: "'Archivo Black', sans-serif", stretch: 0.85 };
const N3 = { font: "'Russo One', sans-serif", stretch: 0.85 };
const FONT_OF: Record<string, Num> = {
  MIN: N1,
  TEN: N1,
  LAS: N1,
  JAX: N1,
  NYK: N1,
  NYE: N2,
  IND: N2,
  NE: N2,
  BAL: N2,
  CLE: N2,
  SEA: N3,
};
const FONT_NAME = (ab: string) =>
  FONT_OF[ab] === N1 ? 'N1' : FONT_OF[ab] === N2 ? 'N2' : FONT_OF[ab] === N3 ? 'N3' : 'today';
const homeLook = (ab: string): Look & Num => {
  const [p, s] = seed(ab).colors;
  return withOutline({ kit: kitFor({ primary: p, secondary: s }), ...FONT_OF[ab] }, ab);
};
const SLABS: [string, string, string, number, string][] = [
  ['S1', 'Heavy slab (round 5)', "'Alfa Slab One', serif", 0.8, 'As before, now outlined.'],
  ['S2', 'Roboto Slab', "'Roboto Slab', serif", 0.95, 'A sturdy slab, a step lighter.'],
  ['S3', 'Bitter', "'Bitter', serif", 0.95, 'A bookish slab: lighter still, old-fashioned.'],
  ['S4', 'Zilla Slab', "'Zilla Slab', serif", 1.05, 'A tall, lighter slab with a typewriter feel.'],
];
const classicIn = (ab: string, font: string, stretch: number): Look & Num => {
  const c = classicOf(ab);
  return withOutline({ ...c, font, stretch }, ab);
};
const SLAB_CLUBS = ['KC', 'GB', 'CHI', 'DAL', 'MIA', 'SF', 'PIT', 'DEN'];
const slabRows = SLABS.map(
  ([tag, name, font, stretch, note]) =>
    `<section class="row"><div class="rowhead"><span class="tag">${tag}</span><b>${name}</b><p>${note}</p></div><div class="cells"><div class="cell">${svg({ player: pl(0), team: teamOf('KC', 0), size: 160, kitOver: classicIn('KC', font, stretch).kit, design: classicOf('KC').design, sleeves: 'three', font, stretch, outline: classicIn('KC', font, stretch).outline })}<span>close-up</span></div>${SLAB_CLUBS.map((ab, i) => one(ab, i, classicIn(ab, font, stretch), ab, 88)).join('')}</div></section>`,
).join('');

const fixed = ['CAR', 'ARI']
  .map(
    (ab, i) =>
      `<figure class="club"><figcaption><b>${seed(ab).city} ${seed(ab).name}</b></figcaption><div class="cells">${one(ab, i, homeLook(ab), 'Home')}${one(ab, i, rushOf(ab), 'Whiteout')}${one(ab, i, blackoutOf(ab), 'Blackout')}</div></figure>`,
  )
  .join('');
let n = 0;
const homes = DIVS.map(
  ([div, clubs]) =>
    `<div class="mini-div"><h4>${div}</h4><div class="cells">${clubs
      .map((ab) => {
        const i = n++;
        return one(ab, i, homeLook(ab), `${ab} · ${FONT_NAME(ab)}`, 96);
      })
      .join('')}</div></div>`,
).join('');

const page = `<title>Alternate &amp; Classic Uniforms</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Big+Shoulders+Display:wght@700;800;900&family=IBM+Plex+Mono:wght@400;600&family=Alfa+Slab+One&family=Roboto+Slab:wght@800&family=Bitter:wght@800&family=Zilla+Slab:wght@700&family=Anton&family=Archivo+Black&family=Russo+One&display=swap">
__STYLE__
<main>
  <header class="lede">
    <span class="eyebrow">AFLS · uniform mockups · round 6 · nothing here is in the game yet</span>
    <h1>Alternate &amp; classic uniforms</h1>
    <p>Your notes on round 5: Carolina's whiteout and Arizona's blackout, lighter slabs for the classics, every number outlined, and all 32 home jerseys with a font proposed per club.</p>
  </header>
  <h2>1 · Carolina and Arizona</h2>
  <p class="sub">Carolina: a whiteout, black numbers outlined in blue. Arizona's blackout: numbers in their own cardinal, outlined in white.</p>
  <div class="clubs">${fixed}</div>
  <h2>2 · Classic slabs, lighter</h2>
  <p class="sub">Four slab weights on the classics, every number outlined.</p>
  ${slabRows}
  <h2>3 · Every home jersey, outlined, with its font</h2>
  <p class="sub">Every number now has an outline: the club's second colour where it stands off the jersey and the number (O2), otherwise a dark or light edge. Fonts proposed: N1 tall condensed for Minnesota, Tennessee, the LA Stars, Jacksonville and the NY Knights; N2 wide grotesk for the NY Empire, Indianapolis, New England, Baltimore and Cleveland; N3 squared tech for Seattle; today's for the rest. The alternates take the club's font too.</p>
  ${homes}
  <section class="ask"><h2>What to tell me</h2><ol>
    <li>A classic slab (S1–S4).</li>
    <li>Any club whose font or outline should change.</li>
  </ol></section>
</main>`;
writeFileSync(
  process.argv[2],
  page.replace(
    '__STYLE__',
    STYLE.replace(
      '.ask {',
      `.clubs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 760px) { .clubs { grid-template-columns: minmax(0, 1fr); } }
.club { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: grid; gap: 8px; }
.mini-div { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; display: grid; gap: 6px; }
h4 { margin: 0; font: 600 0.75rem/1 var(--font-data); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.cells { align-items: end; }
.ask {`,
    ),
  ),
);
console.log('wrote');
