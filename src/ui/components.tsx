import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Player, Team } from '../engine/types';
import { band } from './format';

/** Black or white, whichever reads better on `hex`. */
function inkOn(hex: string): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#121915' : '#ffffff';
}

/**
 * A player's picture slot. Until a portrait exists (a roster mod can set `player.portrait`),
 * it shows a neutral bust in team colours with the jersey number, so faces line up and scan
 * like a real roster page.
 */
export function PlayerAvatar({ player, team, size = 32 }: { player: Player; team: Team | null; size?: number }) {
  const label = `${player.firstName} ${player.lastName}`;
  if (player.portrait) {
    return <img className="avatar" src={player.portrait} alt="" width={size} height={size} loading="lazy" />;
  }
  const [c1, c2] = team?.colors ?? ['#4a554e', '#9aa59e'];
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${label} (no photo)`}>
      <circle cx="20" cy="20" r="20" fill={c1} />
      <circle cx="20" cy="20" r="19.25" fill="none" stroke={c2} strokeWidth="1.5" opacity="0.9" />
      <path d="M5.5 37.5c0-9.6 6.4-14.6 14.5-14.6s14.5 5 14.5 14.6A19.5 19.5 0 0 1 5.5 37.5z" fill={c2} />
      <circle cx="20" cy="12.6" r="6" fill="#fff" opacity="0.82" />
      <text x="20" y="36.4" textAnchor="middle" fontSize="12" fontWeight="800" fill={inkOn(c2)} fontFamily="var(--font-display)">
        {player.jersey}
      </text>
    </svg>
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

export function TeamLabel({ team, full, onClick, sub }: { team: Team; full?: boolean; onClick?: () => void; sub?: ReactNode }) {
  const name = full ? `${team.city} ${team.name}` : team.name;
  return (
    <span className="team-inline">
      <TeamChip team={team} />
      <span style={{ minWidth: 0 }}>
        {onClick ? (
          <button className="linklike" onClick={onClick}>
            {name}
          </button>
        ) : (
          name
        )}
        {sub && <small className="muted" style={{ display: 'block', lineHeight: 1.2 }}>{sub}</small>}
      </span>
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
export function FieldStrip({ yardLine, toGain, small, offense, defense }: { yardLine: number; toGain?: number; small?: boolean; offense?: Team; defense?: Team }) {
  const x = (yards: number) => `${8.333 + (Math.max(0, Math.min(100, yards)) / 100) * 83.333}%`;
  return (
    <div className={`field${small ? ' field-sm' : ''}`} role="img" aria-label={`Ball on the ${yardLine < 50 ? 'own' : 'opponent'} ${yardLine <= 50 ? yardLine : 100 - yardLine}`}>
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

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
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
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
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
    (root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('.dialog-body input, .dialog-body select, .dialog-body button') ?? root?.querySelector<HTMLElement>('button'))?.focus();
    return () => opener?.focus?.();
  }, []);
  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, [tabindex]:not([tabindex="-1"])');
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
export function Sheet({ label, team, head, actions, onClose, children }: { label: string; team: Team | null; head: ReactNode; actions?: ReactNode; onClose: () => void; children: ReactNode }) {
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
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])');
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
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className={`sheet-head${actions ? ' has-edit' : ''}`} style={{ background: team?.colors[0] ?? '#333', boxShadow: `inset 0 -6px 0 ${team?.colors[1] ?? '#666'}` }}>
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
export function Section({ id, title, defaultOpen = true, className = '', children }: { id: string; title: ReactNode; defaultOpen?: boolean; className?: string; children: ReactNode }) {
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
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => number | string): T[] {
  const dir = sort.desc ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: value(row, sort.key) }))
    .sort((a, b) => (a.v < b.v ? -dir : a.v > b.v ? dir : a.i - b.i))
    .map((x) => x.row);
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
