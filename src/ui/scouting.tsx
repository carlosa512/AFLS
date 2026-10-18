/**
 * How the user's front office sees players. Every screen reads ratings through here, never from
 * `player.ratings` directly: own players are exact, everyone else is a scouted estimate.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { agingFamily } from '../engine/aging';
import { AGING_TEXT, ATTRIBUTE_INFO, CONTESTS, contestsFor, relevantAttributes, type AttributeGroup } from '../engine/attributes';
import { overall, OVR_WEIGHTS } from '../engine/positions';
import { repsSoFar } from '../engine/development';
import { fitContests, fitGrade, spotsFor, type FitGrade, type TeamScheme } from '../engine/schemes';
import {
  characterNotes,
  COMBINE_TYPICAL,
  needsReps,
  perceive,
  quirkNotes,
  scoutPlayer,
  starRating,
  type CharacterNotes,
  type PlayerView,
  type QuirkNotes,
  type RatingView,
  type StaffRead,
  type StarRating,
  type StarScale,
} from '../engine/scouting';
import type { Attribute, Combine, League, Player, Position, Ratings } from '../engine/types';
import { ATTRIBUTES } from '../engine/types';
import { Rating, TipPill } from './components';
import { QUIRKS } from '../engine/quirks';
import { band, heightFt, resultsSeason } from './format';
import { store } from './store';

/** The user's view of a player: what every screen should show. */
export const viewOf = (league: League, p: Player): PlayerView => perceive(league, league.userTeamId, p);
export const seenOvr = (league: League, p: Player) => viewOf(league, p).ovr;
export const starsOf = (league: League, p: Player, scale: StarScale = 'league', view = viewOf(league, p)) =>
  starRating(league, league.userTeamId, p, view, scale);

/** Overall as a table cell: exact for your players, a dashed "estimate" chip for everyone else. */
export function Ovr({ league, player, decimals = 1 }: { league: League; player: Player; decimals?: number }) {
  const v = viewOf(league, player);
  if (v.exact) return <Rating value={v.ovr} decimals={decimals} />;
  const range = `${v.ovrLo.toFixed(1)}–${v.ovrHi.toFixed(1)}`;
  return (
    <span className={`rating est ${band(v.ovr)}`} title={`Scouted estimate: ${range}`}>
      {v.ovr.toFixed(decimals)}
      <span className="visually-hidden"> (estimate, {range})</span>
    </span>
  );
}

/** One rating: a single value when known, "11–14" when it's a scouted range. */
export function RangeValue({ r }: { r: RatingView }) {
  if (r.lo === r.hi) return <span className={`num attr-num ${band(r.value)}`}>{r.value}</span>;
  return (
    <span className={`num attr-num range ${band(r.value)}`}>
      {r.lo}–{r.hi}
    </span>
  );
}

/** A staff rating as a fact: the number for your own people, your read ("9–13") for anyone else's. */
export function StaffSkill({ label, value }: { label: string; value: number | StaffRead }) {
  const r = typeof value === 'number' ? { value, lo: value, hi: value, exact: true } : value;
  return (
    <span className="fact">
      <span className="eyebrow">{label}</span>
      <b className={`num ${band(r.value)}`}>
        {r.exact ? r.value : `${r.lo}–${r.hi}`}
        {!r.exact && <span className="visually-hidden"> (your read)</span>}
      </b>
    </span>
  );
}

/** Projected ceiling as whole ratings: "14" when the staff is sure, "13–16" when it isn't. */
export function potentialText(v: PlayerView): string {
  const lo = Math.round(v.potLo);
  const hi = Math.max(lo, Math.round(v.potHi));
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

const half = (n: number) => `${Math.floor(n)}${n % 1 ? '½' : ''}`;

export function starLabel(s: StarRating): string {
  const ceiling = s.potHi > s.ability ? `; ceiling ${s.potLo === s.potHi ? half(s.potHi) : `${half(s.potLo)} to ${half(s.potHi)}`}` : '';
  return `${half(s.ability)} of 4 stars${ceiling} (${s.basis})`;
}

const STAR = 'M12 2.4l2.95 6.2 6.75.8-5 4.7 1.33 6.7L12 17.5l-6.03 3.3 1.33-6.7-5-4.7 6.75-.8z';

/**
 * 0–4 stars in half steps. Solid gold is current ability; a lighter step of the same gold runs to
 * the low end of the projected ceiling, and the palest step to its high end.
 */
export function Stars({ s, size = 18 }: { s: StarRating; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const part = (level: number, i: number) => 24 * Math.max(0, Math.min(1, level - i));
  return (
    <span className="stars" role="img" aria-label={starLabel(s)} title={starLabel(s)}>
      {[0, 1, 2, 3].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            {(['now', 'likely', 'possible'] as const).map((k) => (
              <clipPath key={k} id={`${uid}-${i}-${k}`}>
                <rect width={part(k === 'now' ? s.ability : k === 'likely' ? s.potLo : s.potHi, i)} height="24" />
              </clipPath>
            ))}
          </defs>
          <path d={STAR} className="star-empty" />
          <path d={STAR} className="star-possible" clipPath={`url(#${uid}-${i}-possible)`} />
          <path d={STAR} className="star-likely" clipPath={`url(#${uid}-${i}-likely)`} />
          <path d={STAR} className="star-now" clipPath={`url(#${uid}-${i}-now)`} />
        </svg>
      ))}
    </span>
  );
}

// ───────── star scale preference (per viewer) ─────────

const SCALE_KEY = 'afls.starScale';
let scalePref: StarScale = (() => {
  try {
    return localStorage.getItem(SCALE_KEY) === 'roster' ? 'roster' : 'league';
  } catch {
    return 'league';
  }
})();
const scaleListeners = new Set<(s: StarScale) => void>();

/** League-relative or roster-relative stars, remembered across sessions on this device. */
export function useStarScale(): [StarScale, (s: StarScale) => void] {
  const [scale, setScale] = useState(scalePref);
  useEffect(() => {
    scaleListeners.add(setScale);
    return () => void scaleListeners.delete(setScale);
  }, []);
  const set = (s: StarScale) => {
    scalePref = s;
    try {
      localStorage.setItem(SCALE_KEY, s);
    } catch {
      // Storage can be unavailable; the choice still holds for this session.
    }
    for (const l of scaleListeners) l(s);
  };
  return [scale, set];
}

export function StarScaleToggle({ scale, onChange }: { scale: StarScale; onChange: (s: StarScale) => void }) {
  return (
    <div className="seg seg-sm" role="group" aria-label="Compare stars against">
      <button aria-pressed={scale === 'league'} onClick={() => onChange('league')}>
        League
      </button>
      <button aria-pressed={scale === 'roster'} onClick={() => onChange('roster')}>
        My starters
      </button>
    </div>
  );
}

// ───────── knowledge & scouting ─────────

/** How well your staff knows a player, in a word: the bar shows the rest. */
const knownWord = (k: number) => (k >= 0.95 ? 'Well' : k >= 0.7 ? 'Good' : k >= 0.45 ? 'Fair' : k >= 0.2 ? 'Thin' : 'Barely');

export function KnowledgeMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="known" title={`Your staff knows about ${pct}% of what there is to know`}>
      <span className="known-track" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="small">{knownWord(value)}</span>
    </span>
  );
}

// ───────── makeup & playing time ─────────

/** What your scouts say about a player's makeup: words only, and only once they know him well enough. */
export const makeupOf = (league: League, p: Player): CharacterNotes => characterNotes(league, league.userTeamId, p);

/**
 * Makeup as pills. The word carries the meaning and the tint only backs it up; early word gets a
 * dashed outline (like a dashed grade, it's a guess). Past `limit`, red flags are kept first and the
 * rest collapse into a "+N" (its labels stay available to hover and to screen readers).
 */
export function MakeupPills({ notes, hedged = false, limit, oneLine = false }: { notes: CharacterNotes['notes']; hedged?: boolean; limit?: number; oneLine?: boolean }) {
  if (notes.length === 0) return null;
  const ordered = limit !== undefined && notes.length > limit ? [...notes].sort((a, b) => Number(b.tone === 'warn') - Number(a.tone === 'warn')) : notes;
  const shown = limit === undefined ? ordered : ordered.slice(0, limit);
  const rest = ordered.slice(shown.length);
  return (
    <span className={`pill-row${oneLine ? ' nowrap' : ''}`}>
      {shown.map((n) => (
        <TipPill key={n.label} className={`${n.tone === 'good' ? 'tag-good' : 'tag-warn'}${hedged ? ' tag-early' : ''}`} tip={hedged ? `Early word: ${n.line}` : n.line}>
          {n.label}
          {hedged && <span className="visually-hidden"> (early word)</span>}
        </TipPill>
      ))}
      {rest.length > 0 && (
        <span className="muted small" title={rest.map((n) => n.label).join(', ')}>
          +{rest.length}
          <span className="visually-hidden"> more: {rest.map((n) => n.label).join(', ')}</span>
        </span>
      )}
    </span>
  );
}

/** The habits your scouts have spotted in a player on film (all of them, for your own players). */
export const quirksOf = (league: League, p: Player): QuirkNotes => quirkNotes(league, league.userTeamId, p);

/**
 * Quirks as pills: green for a plus, amber for a minus, plain for a style that trades one thing for
 * another. A habit only starting to show is dashed, like early word on makeup.
 */
export function QuirkPills({ notes, limit, oneLine = false }: { notes: QuirkNotes['notes']; limit?: number; oneLine?: boolean }) {
  if (notes.length === 0) return null;
  // Past `limit`, the minuses stay in view (they're what a board scans for) and the rest collapse into "+N".
  const ordered = limit !== undefined && notes.length > limit ? [...notes].sort((a, b) => Number(b.tone === 'bad') - Number(a.tone === 'bad')) : notes;
  const shown = limit === undefined ? ordered : ordered.slice(0, limit);
  const rest = ordered.slice(shown.length);
  return (
    <span className={`pill-row${oneLine ? ' nowrap' : ''}`}>
      {shown.map((n) => (
        <TipPill
          key={n.id}
          className={`${n.tone === 'good' ? 'tag-good' : n.tone === 'bad' ? 'tag-warn' : ''}${n.forming ? ' tag-early' : ''}`}
          tip={
            <>
              {/* What the scouts see, then what it does on the field. */}
              {n.forming ? 'Starting to show: h' : 'H'}e {QUIRKS[n.id].clause}.
              <b className="tip-effect">In a game: {QUIRKS[n.id].effect}</b>
            </>
          }
        >
          {n.label}
          {n.forming && <span className="visually-hidden"> (starting to show)</span>}
        </TipPill>
      ))}
      {rest.length > 0 && (
        <span className="muted small" title={rest.map((n) => n.label).join(', ')}>
          +{rest.length}
          <span className="visually-hidden"> more: {rest.map((n) => n.label).join(', ')}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Playing time for one of your own young players in the season being reported on, or null when it
 * doesn't apply (not yours, past 25, too early in the year to say, or not in the league that season yet).
 */
export function repsOf(league: League, p: Player): { season: number; share: number; needs: boolean } | null {
  if (p.teamId !== league.userTeamId || p.age > 25) return null;
  const season = resultsSeason(league);
  // A rookie looking back at last season was still in college (the same rule `needsReps` applies).
  if (season < league.season && p.experience === 0) return null;
  const share = repsSoFar(league, p, season);
  if (share === null) return null;
  return { season, share, needs: needsReps(league, league.userTeamId, p, season) };
}

export function ScoutButton({ league, player, label = 'Scout' }: { league: League; player: Player; label?: string }) {
  if (player.teamId === league.userTeamId || player.retired) return null;
  const v = viewOf(league, player);
  const left = league.scoutPoints;
  const done = v.knowledge >= 0.97;
  return (
    <button
      className="btn btn-sm"
      disabled={left <= 0 || done}
      title={
        done
          ? 'Your staff already knows him well'
          : left <= 0
            ? 'No scouting visits left this year'
            : `Send a scout: narrows his ranges (${left} visits left this year)`
      }
      onClick={() => store.mutate((l) => void scoutPlayer(l, player.id))}
    >
      {label}
    </button>
  );
}

// ───────── attributes ─────────

const GROUPS: AttributeGroup[] = ['Physical', 'Mental', 'Passing', 'Ball skills', 'Blocking', 'Defense', 'Kicking'];

const toRatings = (values: number[]) => Object.fromEntries(ATTRIBUTES.map((a, i) => [a, values[i]])) as Ratings;

/** Change in each rating since the previous league year (exact views only). */
function lastChange(p: Player): Partial<Record<Attribute, number>> {
  const seasons = Object.keys(p.ratingHistory ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  if (seasons.length < 2) return {};
  const prev = toRatings(p.ratingHistory![seasons.at(-2)!]);
  return Object.fromEntries(ATTRIBUTES.map((a) => [a, p.ratings[a] - prev[a]]));
}

function AttrRow({ attr, r, position, delta, isKey }: { attr: Attribute; r: RatingView; position: Position; delta?: number; isKey: boolean }) {
  const [open, setOpen] = useState(false);
  const info = ATTRIBUTE_INFO[attr];
  const used = contestsFor(attr, position).map((c) => CONTESTS[c].label);
  return (
    <div className={`attr-row${isKey ? ' key' : ''}`}>
      <button className="attr-name" aria-expanded={open} onClick={() => setOpen(!open)}>
        {info.label}
      </button>
      <span className="attr-val">
        {delta ? (
          <span className={`attr-delta ${delta > 0 ? 'tone-good' : 'tone-bad'}`}>
            <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span>
            {Math.abs(delta)}
            <span className="visually-hidden">{delta > 0 ? ' up' : ' down'} since last season</span>
          </span>
        ) : null}
        <RangeValue r={r} />
      </span>
      {open && (
        <p className="attr-tip">
          {info.about}{' '}
          {used.length ? (
            <>
              At {position}: {used.join(', ').toLowerCase()}.
            </>
          ) : (
            <>The engine doesn't use it at {position}.</>
          )}{' '}
          <span className="muted">{AGING_TEXT[agingFamily(position, attr)]}</span>
        </p>
      )}
    </div>
  );
}

/** Ratings that matter at his position first (bold ones drive the overall); the rest folded away. */
export function AttributeList({ player: p, view }: { player: Player; view: PlayerView }) {
  const relevant = relevantAttributes(p.position);
  const others = ATTRIBUTES.filter((a) => !relevant.includes(a));
  const delta = view.exact ? lastChange(p) : {};
  const weights = OVR_WEIGHTS[p.position];
  const row = (a: Attribute) => <AttrRow key={a} attr={a} r={view.ratings[a]} position={p.position} delta={delta[a]} isKey={!!weights[a]} />;
  return (
    <>
      <div className="attr-grid">{relevant.map(row)}</div>
      <details className="more">
        <summary>Other ratings ({others.length})</summary>
        <div className="attr-grid">
          {GROUPS.flatMap((g) => {
            const attrs = others.filter((a) => ATTRIBUTE_INFO[a].group === g);
            return attrs.length
              ? [
                  <div key={g} className="eyebrow attr-group">
                    {g}
                  </div>,
                  ...attrs.map(row),
                ]
              : [];
          })}
        </div>
      </details>
    </>
  );
}

// ───────── development chart ─────────

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Overall by league year, as the user's staff sees it (an estimate's error shifts the whole line). */
export function DevelopmentChart({ league, player: p }: { league: League; player: Player }) {
  const view = viewOf(league, p);
  const shift = view.ovr - overall(p.ratings, p.position);
  const points = Object.entries(p.ratingHistory ?? {})
    .map(([season, values]) => ({
      season: Number(season),
      ovr: overall(toRatings(values), p.position) + shift,
    }))
    .sort((a, b) => a.season - b.season);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {points.length
          ? `Rated ${points[0].ovr.toFixed(1)} in ${points[0].season}. His development history starts next league year.`
          : 'No development history on file yet.'}
      </p>
    );
  }

  const H = 132;
  const pad = { l: 30, r: 46, t: 12, b: 24 };
  let lo = Math.max(1, Math.floor(Math.min(...points.map((x) => x.ovr)) - 0.5));
  let hi = Math.min(20, Math.ceil(Math.max(...points.map((x) => x.ovr)) + 0.5));
  // An even span puts the middle tick on a whole number, halfway up.
  if ((hi - lo) % 2) {
    if (hi < 20) hi++;
    else if (lo > 1) lo--;
  }
  const span = Math.max(2, hi - lo);
  const w = Math.max(0, width - pad.l - pad.r);
  const x = (i: number) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const ticks = span <= 2 || span % 2 ? [lo, hi] : [lo, (lo + hi) / 2, hi];
  const path = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.ovr).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  const active = hover ?? null;

  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - pad.l) / Math.max(1, w);
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))));
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(last, (h ?? last) + (e.key === 'ArrowRight' ? 1 : -1))));
  };

  return (
    <div className="dev-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          tabIndex={0}
          aria-label={`Overall by season: ${points.map((pt) => `${pt.season} ${pt.ovr.toFixed(1)}`).join(', ')}. Use the arrow keys to step through seasons.`}
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(last)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
              <text className="axis" x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          <text className="axis" x={x(0)} y={H - 6} textAnchor="start">
            {points[0].season}
          </text>
          <text className="axis" x={x(last)} y={H - 6} textAnchor="end">
            {points[last].season}
          </text>
          {active !== null && <line className="crosshair" x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} />}
          <path className="line" d={path} />
          {active !== null && active !== last && <circle className="dot" cx={x(active)} cy={y(points[active].ovr)} r={4} />}
          <circle className="dot" cx={x(last)} cy={y(points[last].ovr)} r={4} />
          <text className="end-label" x={x(last) + 9} y={y(points[last].ovr)} dy="0.32em">
            {points[last].ovr.toFixed(1)}
          </text>
        </svg>
      )}
      {active !== null && width > 0 && (
        <div
          className="chart-tip dev-tip"
          style={{
            left: Math.min(Math.max(x(active), 40), width - 40),
            top: Math.max(0, y(points[active].ovr) - 52),
          }}
          aria-hidden="true"
        >
          <b className="num">{points[active].ovr.toFixed(1)}</b>
          <span>{points[active].season}</span>
        </div>
      )}
      <p className="muted small dev-table">
        {points.map((pt) => (
          <span key={pt.season}>
            {pt.season} <b className="num">{pt.ovr.toFixed(1)}</b>
          </span>
        ))}
      </p>
    </div>
  );
}

// ───────── combine ─────────

const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
export const inches = (v: number) => `${Math.floor(v)}${EIGHTHS[Math.round((v % 1) * 8) % 8]}"`;
const feetInches = (v: number) => `${Math.floor(v / 12)}'${v % 12}"`;

type Drill = {
  key: keyof Combine;
  label: string;
  fmt: (v: number) => string;
  lowerIsBetter?: boolean;
  typical?: number;
};

export function combineRows(p: Player): Drill[] {
  const t = p.position === 'K' || p.position === 'P' ? null : COMBINE_TYPICAL[p.position];
  return [
    {
      key: 'forty',
      label: '40-yard dash',
      fmt: (v) => `${v.toFixed(2)}s`,
      lowerIsBetter: true,
      typical: t?.[0],
    },
    {
      key: 'bench',
      label: 'Bench press (225)',
      fmt: (v) => `${v} reps`,
      typical: t?.[1] || undefined,
    },
    {
      key: 'vertical',
      label: 'Vertical jump',
      fmt: (v) => `${v}"`,
      typical: t?.[2],
    },
    { key: 'broad', label: 'Broad jump', fmt: feetInches, typical: t?.[3] },
    {
      key: 'shuttle',
      label: '20-yard shuttle',
      fmt: (v) => `${v.toFixed(2)}s`,
      lowerIsBetter: true,
      typical: t?.[4],
    },
    {
      key: 'cone',
      label: '3-cone drill',
      fmt: (v) => `${v.toFixed(2)}s`,
      lowerIsBetter: true,
      typical: t?.[5],
    },
  ];
}

/** Better or worse than an average starter at his position, by a margin that means something. */
export function drillVerdict(d: Drill, v: number): 'good' | 'bad' | null {
  if (d.typical === undefined) return null;
  const margin = { forty: 0.06, bench: 3, vertical: 2, broad: 5, shuttle: 0.07, cone: 0.1 }[d.key as 'forty'] ?? 0;
  const better = d.lowerIsBetter ? d.typical - v : v - d.typical;
  return better >= margin ? 'good' : better <= -margin ? 'bad' : null;
}

export function CombinePanel({ player: p }: { player: Player }) {
  const c = p.combine;
  if (!c)
    return (
      <p className="muted small" style={{ margin: 0 }}>
        No combine results on file.
      </p>
    );
  // Kickers only measure; a drill nobody at his position runs (a quarterback's bench) isn't listed.
  const drills = p.position === 'K' || p.position === 'P' ? [] : combineRows(p).filter((d) => c[d.key] !== undefined || d.typical !== undefined);
  return (
    <div className="combine">
      <div className="facts">
        <span className="fact">
          <span className="eyebrow">Height</span>
          <b className="num">{heightFt(p.heightIn)}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Weight</span>
          <b className="num">{p.weightLb}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Arms</span>
          <b className="num">{inches(c.arms)}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Hands</span>
          <b className="num">{inches(c.hands)}</b>
        </span>
      </div>
      {drills.length > 0 && (
        <div className="table-scroll">
          <table className="combine-table">
            <thead>
              <tr>
                <th>Drill</th>
                <th className="num">Result</th>
                <th className="num" title={`An average starting ${p.position} at the combine`}>
                  Typical {p.position}
                </th>
              </tr>
            </thead>
            <tbody>
              {drills.map((d) => {
                const v = c[d.key];
                const verdict = v === undefined ? null : drillVerdict(d, v);
                return (
                  <tr key={d.key}>
                    <td>{d.label}</td>
                    <td className="num">
                      {v === undefined ? (
                        <span className="muted">Did not do</span>
                      ) : (
                        <span className={verdict === 'good' ? 'tone-good' : verdict === 'bad' ? 'tone-bad' : undefined}>
                          {verdict && <span aria-hidden="true">{verdict === 'good' ? '▲ ' : '▼ '}</span>}
                          {d.fmt(v)}
                          {verdict && <span className="visually-hidden">{verdict === 'good' ? ' (better than typical)' : ' (worse than typical)'}</span>}
                        </span>
                      )}
                    </td>
                    <td className="num muted">{d.typical !== undefined ? d.fmt(d.typical) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────── scheme fit ─────────

export interface SchemeFit {
  grade: FitGrade;
  /** The skills the scheme leans on at his position, in words ("outside running"). */
  skills: string[];
}

/**
 * How a player fits a set of schemes, as the user's scouts read him (ranges' best guesses, never his
 * true ratings). Null where the scheme asks nothing special of his position.
 */
export function schemeFitOf(league: League, p: Player, scheme: TeamScheme): SchemeFit | null {
  const contests = fitContests(scheme, p.position);
  if (!contests.length) return null;
  const view = viewOf(league, p);
  const values = contests.map((c) => {
    const w: Partial<Record<Attribute, number>> = CONTESTS[c].weights;
    return (Object.keys(w) as Attribute[]).reduce((sum, a) => sum + view.ratings[a].value * w[a]!, 0);
  });
  const grade = fitGrade(values);
  return grade ? { grade, skills: contests.map((c) => CONTESTS[c].label.toLowerCase()) } : null;
}

/** How the user's starters would fit a scheme: how many fit well and how many poorly. */
export function rosterFit(league: League, teamId: number, scheme: TeamScheme, side: 'offense' | 'defense'): { good: number; poor: number; asked: number } {
  const team = league.teams[teamId];
  const positions: Position[] = side === 'offense' ? ['QB', 'RB', 'WR', 'TE', 'OL'] : ['DT', 'EDGE', 'LB', 'CB', 'S'];
  let good = 0;
  let poor = 0;
  let asked = 0;
  for (const pos of positions) {
    const n = spotsFor(scheme, pos).length;
    for (const id of team.depthChart[pos].slice(0, n)) {
      const fit = schemeFitOf(league, league.players[id], scheme);
      if (!fit) continue;
      asked++;
      if (fit.grade === 'Ideal' || fit.grade === 'Good') good++;
      if (fit.grade === 'Poor') poor++;
    }
  }
  return { good, poor, asked };
}
