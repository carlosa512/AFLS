import { useEffect, useRef } from 'react';
import { playerOvr, POSITION_NAMES } from '../../engine/positions';
import { passerRating } from '../../engine/stats';
import type { Attribute, League, Player, StatLine } from '../../engine/types';
import { useNav } from '../App';
import { PlayerAvatar, Rating } from '../components';
import { ATTR_LABELS, band, heightFt, keyAttributes, money } from '../format';

const GROUPS: [string, Attribute[]][] = [
  ['Physical', ['speed', 'agility', 'strength']],
  ['Mental', ['awareness']],
  ['Passing', ['throwPower', 'throwAccShort', 'throwAccDeep']],
  ['Ball skills', ['carrying', 'elusiveness', 'catching', 'routeRunning']],
  ['Blocking', ['passBlock', 'runBlock']],
  ['Defense', ['tackling', 'passRush', 'runStop', 'coverage']],
  ['Kicking', ['kickPower', 'kickAccuracy']],
];

type Col = [label: string, value: (s: StatLine) => string | number];

function statColumns(p: Player): Col[] {
  const n = (k: keyof StatLine) => (s: StatLine) => s[k] ?? 0;
  switch (p.position) {
    case 'QB':
      return [
        ['Cmp', n('passCmp')],
        ['Att', n('passAtt')],
        ['Yds', n('passYds')],
        ['TD', n('passTd')],
        ['INT', n('passInt')],
        ['Rate', (s) => passerRating(s).toFixed(1)],
        ['Rush', n('rushYds')],
      ];
    case 'RB':
      return [
        ['Car', n('rushAtt')],
        ['Yds', n('rushYds')],
        ['Avg', (s) => (s.rushAtt ? ((s.rushYds ?? 0) / s.rushAtt).toFixed(1) : '–')],
        ['TD', n('rushTd')],
        ['Rec', n('rec')],
        ['RecYds', n('recYds')],
        ['Fum', n('fumblesLost')],
      ];
    case 'WR':
    case 'TE':
      return [
        ['Tgt', n('targets')],
        ['Rec', n('rec')],
        ['Yds', n('recYds')],
        ['Avg', (s) => (s.rec ? ((s.recYds ?? 0) / s.rec).toFixed(1) : '–')],
        ['TD', n('recTd')],
        ['Long', n('recLong')],
      ];
    case 'K':
      return [
        ['FGM', n('fgMade')],
        ['FGA', n('fgAtt')],
        ['Long', n('fgLong')],
        ['XPM', n('xpMade')],
        ['XPA', n('xpAtt')],
      ];
    case 'P':
      return [
        ['Punts', n('punts')],
        ['Yds', n('puntYds')],
        ['Avg', (s) => (s.punts ? ((s.puntYds ?? 0) / s.punts).toFixed(1) : '–')],
      ];
    case 'OL':
      return [];
    default:
      return [
        ['Tkl', n('tackles')],
        ['TFL', n('tfl')],
        ['Sacks', n('sacks')],
        ['INT', n('defInt')],
        ['PD', n('passDef')],
        ['FF', n('forcedFum')],
      ];
  }
}

export function PlayerCard({ league, player: p, onClose }: { league: League; player: Player; onClose: () => void }) {
  const nav = useNav();
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  const ovr = playerOvr(p);
  const keys = new Set(keyAttributes(p.position, 6));
  const cols = statColumns(p);
  const seasons = Object.keys(p.stats)
    .map(Number)
    .sort((a, b) => b - a);
  // Scouts see potential as a range, not an exact number.
  const potLo = Math.max(ovr, Math.floor(p.potential - 1));
  const potHi = Math.min(20, Math.ceil(p.potential + 1));

  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Modal behaviour: focus moves into the card, Tab stays inside it, and focus returns on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
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
    <div className="overlay" onClick={onClose}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={`${p.firstName} ${p.lastName}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head" style={{ background: team?.colors[0] ?? '#333', boxShadow: `inset 0 -6px 0 ${team?.colors[1] ?? '#666'}` }}>
          <PlayerAvatar player={p} team={team} size={64} />
          <span className="jersey">{p.jersey}</span>
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {POSITION_NAMES[p.position]}
              {team ? ` · ${team.city} ${team.name}` : ' · Free agent'}
            </span>
            <h2 style={{ fontSize: 'var(--step-3)' }}>
              {p.firstName} {p.lastName}
            </h2>
          </div>
          <button ref={closeRef} className="close-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="facts">
            <span className="fact">
              <span className="eyebrow">Overall</span>
              <b>
                <Rating value={ovr} decimals={1} />
              </b>
            </span>
            <span className="fact">
              <span className="eyebrow">Potential (scouted)</span>
              <b className="num">
                {potLo.toFixed(0)}–{potHi}
              </b>
            </span>
            <span className="fact">
              <span className="eyebrow">Age</span>
              <b className="num">{p.age}</b>
            </span>
            <span className="fact">
              <span className="eyebrow">Size</span>
              <b className="num">
                {heightFt(p.heightIn)}, {p.weightLb}
              </b>
            </span>
            <span className="fact">
              <span className="eyebrow">Experience</span>
              <b className="num">{p.experience === 0 ? 'Rookie' : `${p.experience} yr`}</b>
            </span>
            <span className="fact">
              <span className="eyebrow">Contract</span>
              <b className="num">
                {money(p.contract.salary)} × {p.contract.years}
              </b>
            </span>
          </div>

          <div className="attr-grid">
            {GROUPS.map(([group, attrs]) => (
              <div key={group}>
                <div className="eyebrow" style={{ marginBottom: 2 }}>
                  {group}
                </div>
                {attrs.map((a) => (
                  <div key={a} className={`attr-row${keys.has(a) ? ' key' : ''}`}>
                    <span>{ATTR_LABELS[a][1]}</span>
                    <span className={`num ${band(p.ratings[a])}`} style={{ fontWeight: 600 }}>
                      {p.ratings[a]}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
            Bold attributes drive this player's overall at {p.position}. Scale: 1–5 poor, 6–10 backup, 11–15 starter, 16–20 elite.
          </p>

          {cols.length > 0 && seasons.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Season</th>
                    <th className="num">GP</th>
                    {cols.map(([label]) => (
                      <th key={label} className="num">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((season) => (
                    <tr key={season}>
                      <td className="num">{season}</td>
                      <td className="num">{p.stats[season].gp ?? 0}</td>
                      {cols.map(([label, f]) => (
                        <td key={label} className="num">
                          {f(p.stats[season])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {team && (
            <div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  onClose();
                  nav.openTeam(team.id);
                }}
              >
                View {team.name} roster
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
