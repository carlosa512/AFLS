/**
 * The Front Office's shared layout, lifted from the draft room: a hero that says what needs you now, a row
 * of facts, cards for the few things worth a look, and pills where a table would put a number column.
 */
import type { ReactNode } from 'react';
import type { Team } from '../engine/types';
import { Panel, TeamChip } from './components';

/** The tab's hero: an eyebrow, the one line that matters, and gold when it's waiting on you. */
export function OfficeHero({
  eyebrow,
  headline,
  team,
  urgent,
  action,
  children,
}: {
  eyebrow?: ReactNode;
  headline: ReactNode;
  team?: Team;
  urgent?: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Panel
      className={`office-hero${urgent ? ' is-urgent' : ''}`}
      title={
        <div className="row office-hero-head">
          {team && <TeamChip team={team} large />}
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{headline}</h2>
          </div>
        </div>
      }
      action={action}
    >
      {children ?? null}
    </Panel>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <div className="facts">{children}</div>;
}

/** One fact: an eyebrow over its value, and a muted note when the value needs one. */
export function Fact({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <span className="fact">
      <span className="eyebrow">{label}</span>
      <b>{children}</b>
      {note && <span className="muted small"> {note}</span>}
    </span>
  );
}

/** Cards in a row: they wrap on a desktop and swipe sideways on a phone. */
export function CardRow({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div className={`card-row${className ? ` ${className}` : ''}`} aria-label={label}>
      {children}
    </div>
  );
}

export function OfficeCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`office-card${className ? ` ${className}` : ''}`}>{children}</div>;
}

export type PillTone = 'good' | 'warn' | 'bad' | 'early' | 'inactive';

/** A word in a pill, toned when it's good or bad news; plain when it's just a fact. */
export function Pill({
  tone,
  title,
  className,
  children,
}: {
  tone?: PillTone;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`tag-pill${tone ? ` tag-${tone}` : ''}${className ? ` ${className}` : ''}`} title={title}>
      {children}
    </span>
  );
}
