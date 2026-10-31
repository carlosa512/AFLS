import { POSITION_NAMES } from '../engine/positions';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { gamesInWeek } from '../engine/league';
import type { Game, League, Player, Position, Team } from '../engine/types';
import { POSITIONS } from '../engine/types';
import { gameWeather, type Forecast, type Weather } from '../engine/weather';
import { inkOn, kitFor, shade, tint, type TeamColors } from './color';
import { band, gameWeatherText, playerName, severityText, shortName } from './format';
import { useNav } from './nav';
import { playerLook } from './playerLook';
import { store } from './store';

/** Free agents, prospects and staff on the market: the app's grey-green. */
export const FREE_AGENT: TeamColors = { primary: '#4a554e', secondary: '#9aa59e' };
const NUMBER_MIN_PX = 32; // below this the digits turn to mush, and every list shows the name beside him anyway
const NAMEPLATE_MIN_PX = 96; // below this the surname is too small to read
const PLATE_EM = 0.52; // width of a capital per unit of font size: Big Shoulders Display 800, measured, spacing included
export const SKIN = '#3E4A59'; // neutral mannequin: no faces or skin tones to generate
/** Kickoff this hot in the open air, the home team takes white and leaves the visitors the dark jerseys (tune). */
export const HOT_KICKOFF_F = 85;

/**
 * Whether a team takes the field in white. The league's rule: the home team picks, the visitors wear the
 * other jersey. Home teams wear their colours, except on a hot open-air day (Miami, Tampa and Jacksonville
 * in September, mostly), about one game in fifty. It follows this week's game, or `game` for one already
 * played (weather is a pure function of the game, so it comes out the same); with no game (a bye, the
 * offseason) everyone is in home colours.
 */
export function wearsWhite(league: League | null, teamId: number, game?: Game): boolean {
  const inSeason = league?.phase === 'regular' || league?.phase === 'playoffs';
  const g =
    game ??
    (league && inSeason ? gamesInWeek(league).find((x) => x.homeId === teamId || x.awayId === teamId) : undefined);
  if (!league || !g || (g.homeId !== teamId && g.awayId !== teamId)) return false;
  const w = gameWeather(league, g);
  const homeInWhite = (w.roof === 'outdoors' || w.roof === 'open') && w.tempF >= HOT_KICKOFF_F;
  return (g.homeId === teamId) === homeInWhite;
}

/**
 * A player's picture slot. Until a portrait exists (a roster mod can set `player.portrait`), it draws him
 * from behind in his team's jersey: just the figure in lists; his build, head and number from 32px; the surname
 * and his height from 96px (`playerLook`).
 * Decorative: the name is always shown beside it. Pass `game` to dress him for that game instead of this week's.
 */
export function PlayerAvatar({
  player,
  team,
  size = 32,
  game,
}: {
  player: Player;
  team: Team | null;
  size?: number;
  game?: Game;
}) {
  const id = useId();
  if (player.portrait) {
    return <img className="avatar" src={player.portrait} alt="" width={size} height={size} loading="lazy" />;
  }
  const url = (part: string) => `url(#${id}${part})`;
  const colors = team ? { primary: team.colors[0], secondary: team.colors[1] } : FREE_AGENT;
  const { primary } = colors;
  const { jersey, ink, trim, accent } = kitFor(colors, team !== null && wearsWhite(store.get(), team.id, game));
  const { figure: f, head, transform } = playerLook(player, size);
  const plate = player.lastName.toUpperCase();
  // long names shrink, and textLength holds the estimate even if the font hasn't loaded and a wider one stands in
  const plateSize = Math.min(9.5, f.plateMax / (plate.length * PLATE_EM));
  // 15% wider around x = 50 (the condensed display face is narrower than block jersey numerals), less on a narrow back
  const numberX = 1.15 * f.numberWidth;
  return (
    <svg
      className="avatar"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fontFamily="var(--font-display)"
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
      </defs>
      <circle cx="50" cy="50" r="45" fill={url('bg')} />
      <g clipPath={url('c')}>
        <g transform={transform}>
          <path d={f.armL} fill={url('arm')} />
          <path d={f.armR} fill={url('arm')} />
          <path d={f.neck} fill={url('sk')} />
          <path d={f.neckSides} fill="#000" fillOpacity={0.08} />
          <path d={f.neckShade} fill="#000" fillOpacity={0.16} />
          <path d={head.ears} fill={url('sk')} />
          <path d={head.d} fill={url('sk')} />
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
          {size >= NUMBER_MIN_PX && (
            <>
              <path d={f.bandsUpper} stroke={ink} strokeWidth={2} fill="none" />
              <path d={f.bandsLower} stroke={accent} strokeWidth={2} fill="none" />
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
                strokeWidth={1.4}
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

/**
 * A player's name, and it always opens his card. The one way a screen shows a player: `avatar` (a size in
 * px) in tables and lists, none in a sentence; `short` ("J. Smith") for tight cells, `surname` ("Smith")
 * where the picture or the sentence already says who; `pos` only where the table has no position column.
 */
export function PlayerLink({
  league,
  player,
  avatar,
  short = false,
  surname = false,
  pos = false,
  bold = false,
  className,
}: {
  league: League;
  player: Player;
  avatar?: number;
  short?: boolean;
  surname?: boolean;
  pos?: boolean;
  bold?: boolean;
  className?: string;
}) {
  const nav = useNav();
  const team = player.teamId !== null ? league.teams[player.teamId] : null;
  const classes = ['linklike', avatar ? 'player-link' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      style={bold ? { fontWeight: 700 } : undefined}
      onClick={() => nav.openPlayer(player.id)}
    >
      {avatar ? <PlayerAvatar player={player} team={team} size={avatar} /> : null}
      <span>
        {pos ? `${player.position} ` : ''}
        {surname ? player.lastName : short ? shortName(player) : playerName(player)}
      </span>
    </button>
  );
}

export function TeamChip({ team, large }: { team: Team; large?: boolean }) {
  const style = { '--c1': team.colors[0], '--c2': team.colors[1], color: inkOn(team.colors[0]) } as CSSProperties;
  return (
    <span className={`chip${large ? ' chip-lg' : ''}`} style={style} aria-hidden="true">
      {team.abbrev}
    </span>
  );
}

/**
 * A team's name, and it always opens its page. The one way a screen shows a team: `chip` (the colour chip
 * before the name) in tables and lists, none in a sentence; `full` for "Dallas Rangers" over "Rangers";
 * `sub` a record or note under the name, outside the link.
 */
export function TeamLink({
  team,
  chip = false,
  full = false,
  sub,
  className,
}: {
  team: Team;
  chip?: boolean;
  full?: boolean;
  sub?: ReactNode;
  className?: string;
}) {
  const nav = useNav();
  const name = full ? `${team.city} ${team.name}` : team.name;
  const link = (
    <button
      type="button"
      className={className ? `linklike ${className}` : 'linklike'}
      onClick={() => nav.openTeam(team.id)}
    >
      {name}
    </button>
  );
  const note = sub && (
    <small className="muted" style={{ display: 'block', lineHeight: 1.2 }}>
      {sub}
    </small>
  );
  if (!chip) {
    return (
      <>
        {link}
        {note}
      </>
    );
  }
  return (
    <span className="team-inline">
      <TeamChip team={team} />
      <span style={{ minWidth: 0 }}>
        {link}
        {note}
      </span>
    </span>
  );
}

/** A game's weather: what it was played in, or its forecast (muted while it's only the city's averages). */
export function WeatherNote({ weather, forecast }: { weather?: Weather; forecast: Forecast | null }) {
  const w = gameWeatherText(weather, forecast);
  return (
    <span className={w.outlook ? 'muted' : undefined}>
      {w.text}
      {w.severity !== 'none' && <strong> · {severityText(w.severity)}</strong>}
    </span>
  );
}

/** A 1–20 rating, colour-banded FM-style. */
export function Rating({ value, decimals = 0 }: { value: number; decimals?: number }) {
  return <span className={`rating ${band(value)}`}>{value.toFixed(decimals)}</span>;
}

/**
 * A 120-yard field strip, offense driving left to right. `yardLine` is yards
 * from the offense's own goal line; `toGain` is the absolute line to gain.
 */
export function FieldStrip({
  yardLine,
  toGain,
  small,
  offense,
  defense,
}: {
  yardLine: number;
  toGain?: number;
  small?: boolean;
  offense?: Team;
  defense?: Team;
}) {
  const x = (yards: number) => `${8.333 + (Math.max(0, Math.min(100, yards)) / 100) * 83.333}%`;
  return (
    <div
      className={`field${small ? ' field-sm' : ''}`}
      role="img"
      aria-label={`Ball on the ${yardLine < 50 ? 'own' : 'opponent'} ${yardLine <= 50 ? yardLine : 100 - yardLine}`}
    >
      <span className="endzone left" style={{ background: offense?.colors[0] ?? 'rgba(0,0,0,.25)' }}>
        {offense?.abbrev}
      </span>
      <div className="field-inner" />
      <span className="endzone right" style={{ background: defense?.colors[0] ?? 'rgba(0,0,0,.25)' }}>
        {defense?.abbrev}
      </span>
      {toGain !== undefined && toGain < 100 && <span className="togain" style={{ left: x(toGain) }} />}
      <span className="ball" style={{ left: x(yardLine) }} />
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <div className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Backdrop handlers for a modal: close only when the press both starts and ends on the backdrop
 * itself, so a drag that begins inside (a slider, a text selection) and ends outside doesn't close it.
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: ReactMouseEvent) => (downOnBackdrop.current = e.target === e.currentTarget),
    onClick: (e: ReactMouseEvent) => {
      if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      downOnBackdrop.current = false;
    },
  };
}

/**
 * A small modal: focus moves in, Tab stays inside, Escape closes, focus returns to the opener.
 * Key events stop here so a dialog opened over the player card doesn't close the card too.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useBackdropClose(onClose);
  // Escape closes the top-most dialog even if focus has wandered; capture runs before the player card's handler.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>('.dialog-body input, .dialog-body select, .dialog-body button') ??
      root?.querySelector<HTMLElement>('button')
    )?.focus();
    return () => opener?.focus?.();
  }, []);
  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = ref.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input, select, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="overlay dialog-overlay" {...backdrop} onKeyDown={onKey}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="close-x dialog-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * A full card over the page (a player, a coach): a head in team colours, then the body. Focus moves in,
 * Tab stays inside, Escape or the backdrop closes it, and focus returns to the opener.
 */
export function Sheet({
  label,
  team,
  head,
  actions,
  onClose,
  children,
}: {
  label: string;
  team: Team | null;
  head: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const backdrop = useBackdropClose(onClose);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" {...backdrop}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`sheet-head${actions ? ' has-edit' : ''}`}
          style={{ background: team?.colors[0] ?? '#333', boxShadow: `inset 0 -6px 0 ${team?.colors[1] ?? '#666'}` }}
        >
          {head}
          {actions}
          <button ref={closeRef} className="close-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * A pill that says what it means: hover it with a mouse, tap it on a phone (a title tooltip never shows on
 * touch). The note floats over the page from <body>, so a table's scroll box can't clip it; scrolling, a tap
 * elsewhere or Escape puts it away.
 */
export function TipPill({
  className = '',
  tip,
  children,
}: {
  className?: string;
  tip: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const id = useId();
  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    // 280px wide at most: keep it on screen at the right edge.
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 288)), top: r.bottom + 6 });
  };
  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && hide();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [at]);
  return (
    <button
      ref={ref}
      type="button"
      className={`tag-pill tip-pill ${className}`.trim()}
      aria-expanded={!!at}
      aria-describedby={at ? id : undefined}
      // A tap inside a clickable row explains the pill; it doesn't open the row. It only ever opens the
      // note: a mouse has already opened it by hovering, and a click mustn't snap it shut again.
      onClick={(e) => {
        e.stopPropagation();
        show();
      }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setAt(null)}
    >
      {children}
      {at &&
        createPortal(
          <span id={id} role="tooltip" className="tip-body" style={{ left: at.left, top: at.top }}>
            {tip}
          </span>,
          document.body,
        )}
    </button>
  );
}

/** Words first, the exact figures one tap away: the verdict is the line you read, the numbers open under it. */
export function Exact({ numbers, children }: { numbers: ReactNode; children: ReactNode }) {
  return (
    <details className="exact">
      <summary>{children}</summary>
      <span className="exact-numbers">{numbers}</span>
    </details>
  );
}

/**
 * Pick a club, yours marked: the one team dropdown, wherever a screen can show another team. `allowLeague`
 * puts "League" first (value 'all'); `exclude` leaves clubs out (the trade table: you can't trade with
 * yourself). A picker without `allowLeague` only ever hands back a team id.
 */
export function TeamPicker(props: {
  league: League;
  value: number;
  onChange: (teamId: number) => void;
  id?: string;
  label?: string;
  allowLeague?: false;
  exclude?: number[];
}): ReactElement;
export function TeamPicker(props: {
  league: League;
  value: number | 'all';
  onChange: (teamId: number | 'all') => void;
  id?: string;
  label?: string;
  allowLeague: true;
  exclude?: number[];
}): ReactElement;
export function TeamPicker({
  league,
  value,
  onChange,
  id,
  label = 'Choose team',
  allowLeague = false,
  exclude = [],
}: {
  league: League;
  value: number | 'all';
  onChange: ((teamId: number) => void) | ((teamId: number | 'all') => void);
  id?: string;
  label?: string;
  allowLeague?: boolean;
  exclude?: number[];
}) {
  // Without `allowLeague` the 'all' option never renders, so the narrower callback never sees it.
  const pick = onChange as (teamId: number | 'all') => void;
  return (
    <select
      aria-label={label}
      id={id}
      value={value}
      onChange={(e) => pick(e.target.value === 'all' ? 'all' : Number(e.target.value))}
    >
      {allowLeague && <option value="all">League</option>}
      {[...league.teams]
        .filter((t) => !exclude.includes(t.id))
        .sort((a, b) => a.city.localeCompare(b.city))
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.city} {t.name}
            {t.id === league.userTeamId ? ' (you)' : ''}
          </option>
        ))}
    </select>
  );
}

/** The league grades tables' columns: by rank (the grade's order) or by team name. */
export type GradesSort = 'rank' | 'team';
export const gradesSortValue = (league: League, teamId: number, rank: number, key: GradesSort): number | string =>
  key === 'rank' ? rank : league.teams[teamId].name.toLowerCase();

/**
 * Every club's department by grade. Tap a team to open its staff underneath (`staffOf` says who, and how
 * good), so the league isn't just a rank: you can see who's behind it.
 */
export function GradesTable({
  league,
  grades,
  staffOf,
}: {
  league: League;
  grades: Map<number, { rank: number; grade: string }>;
  staffOf: (teamId: number) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [sort, onSort] = useSort<GradesSort>({ key: 'rank', desc: false });
  return (
    <div className="table-scroll">
      <table className="league-grades">
        <thead>
          <tr>
            <SortTh label="Rank" k="rank" sort={sort} onSort={onSort} desc={false} className="num" />
            <SortTh label="Team" k="team" sort={sort} onSort={onSort} desc={false} />
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {sortRows([...grades], sort, ([id, g], key) => gradesSortValue(league, id, g.rank, key)).flatMap(
            ([id, g]) => {
              const t = league.teams[id];
              const row = (
                <tr key={id} className={id === league.userTeamId ? 'is-user' : undefined}>
                  <td className="num">{g.rank}</td>
                  <td>
                    <button
                      className="linklike team-inline"
                      aria-expanded={open === id}
                      onClick={() => setOpen(open === id ? null : id)}
                    >
                      <TeamChip team={t} />
                      <span>
                        {t.city} {t.name}
                        {id === league.userTeamId && <span className="tag-pill">You</span>}
                      </span>
                      <span className="muted" aria-hidden="true">
                        {open === id ? '▴' : '▾'}
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className={`grade grade-${g.grade}`}>{g.grade}</span>
                  </td>
                </tr>
              );
              return open === id
                ? [
                    row,
                    <tr key={`${id}-staff`} className="team-staff-row">
                      <td colSpan={3}>{staffOf(id)}</td>
                    </tr>,
                  ]
                : [row];
            },
          )}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS_KEY = 'afls-sections';

function savedSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * A card section that folds away under its heading. Folding one remembers it (per device) for every card,
 * so a section you never read stays out of the way on the next player too.
 */
export function Section({
  id,
  title,
  defaultOpen = true,
  className = '',
  children,
}: {
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => savedSections()[id] ?? defaultOpen);
  return (
    <details
      className={`card-section ${className}`.trim()}
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === open) return;
        setOpen(now);
        try {
          localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...savedSections(), [id]: now }));
        } catch {
          // Storage blocked: the fold lasts until the card closes.
        }
      }}
    >
      <summary>
        <h3>{title}</h3>
      </summary>
      <div className="stack">{children}</div>
    </details>
  );
}

// ───────── sortable tables ─────────

export interface SortState<K extends string> {
  key: K;
  /** Descending puts the biggest value (best OVR, oldest, priciest) first. */
  desc: boolean;
}

/** Column sort: clicking a new column uses its natural order, clicking it again flips it. */
export function useSort<K extends string>(initial: SortState<K>) {
  const [sort, setSort] = useState(initial);
  const toggle = (key: K, desc: boolean) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc }));
  return [sort, toggle, setSort] as const;
}

/** Sorts a copy of `rows` by the value each one gives for the active column (ties keep their order). */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  value: (row: T, key: K) => number | string,
): T[] {
  const dir = sort.desc ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: value(row, sort.key) }))
    .sort((a, b) => (a.v < b.v ? -dir : a.v > b.v ? dir : a.i - b.i))
    .map((x) => x.row);
}

/**
 * The sort control for a list that has no header (the trade assets, your block): the same `SortState` as a
 * table's, as a row of `seg` buttons. Each option names the order its first click uses.
 */
export function SortSeg<K extends string>({
  options,
  sort,
  onSort,
  label,
}: {
  options: { k: K; label: string; desc?: boolean }[];
  sort: SortState<K>;
  onSort: (key: K, desc: boolean) => void;
  label: string;
}) {
  return (
    <div className="seg seg-sm" role="group" aria-label={label}>
      {options.map((o) => {
        const active = sort.key === o.k;
        return (
          <button key={o.k} type="button" aria-pressed={active} onClick={() => onSort(o.k, o.desc ?? true)}>
            {o.label}
            {active ? (sort.desc ? ' ▼' : ' ▲') : ''}
          </button>
        );
      })}
    </div>
  );
}

/** A header cell that sorts its column. `desc` is the order the first click uses. */
export function SortTh<K extends string>({
  label,
  k,
  sort,
  onSort,
  desc = true,
  className,
}: {
  label: ReactNode;
  k: K;
  sort: SortState<K>;
  onSort: (key: K, desc: boolean) => void;
  desc?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={className} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button className="th-sort" onClick={() => onSort(k, desc)}>
        {label}
        <span className="th-arrow" aria-hidden="true">
          {active ? (sort.desc ? '▼' : '▲') : ''}
        </span>
      </button>
    </th>
  );
}

/** The position filter on the draft board and the free-agent list. */
export function PositionFilter({
  value,
  onChange,
}: {
  value: Position | 'ALL';
  onChange: (v: Position | 'ALL') => void;
}) {
  return (
    <select
      aria-label="Filter by position"
      value={value}
      onChange={(e) => onChange(e.target.value as Position | 'ALL')}
    >
      <option value="ALL">All positions</option>
      {POSITIONS.map((p) => (
        <option key={p} value={p}>
          {POSITION_NAMES[p]}
        </option>
      ))}
    </select>
  );
}
