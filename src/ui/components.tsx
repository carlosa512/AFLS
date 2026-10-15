import type { CSSProperties, ReactNode } from 'react';
import type { Team } from '../engine/types';
import { band } from './format';

export function TeamChip({ team, large }: { team: Team; large?: boolean }) {
  const style = { '--c1': team.colors[0], '--c2': team.colors[1] } as CSSProperties;
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
