import { disciplineLines } from '../engine/conductMail';
import type { League, Player } from '../engine/types';
import { Section, TipPill } from './components';

const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

/** A suspension as the roster and the card show it: "Suspended · 1 game", or "Sat by the team · 1 game". Public, like an injury. */
export function ConductTag({ p, sub = false }: { p: Player; sub?: boolean }) {
  const s = p.suspension;
  if (!s || s.games <= 0) return null;
  const team = s.by === 'team';
  return (
    <TipPill
      className={`tag-bad${sub ? ' name-sub' : ''}`}
      tip={
        team
          ? 'His team sat him for a violation of team rules.'
          : 'The league suspended him. He cannot play until it is served.'
      }
    >
      {team ? 'Sat by the team' : 'Suspended'} · {games(s.games)}
    </TipPill>
  );
}

/** His record of trouble in words, this season and last: your own players' in full, another team's only what the public knows. */
export function DisciplineSection({ league, p }: { league: League; p: Player }) {
  const rows = disciplineLines(league, p);
  if (!rows.length) return null;
  return (
    <Section id="discipline" title="Discipline">
      <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
        {rows.map((r, i) => (
          <li key={i}>
            <b>{r.when}</b>: {r.text}
          </li>
        ))}
      </ul>
    </Section>
  );
}
