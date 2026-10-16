import { useEffect, useRef } from 'react';
import { POSITION_NAMES } from '../../engine/positions';
import { isProspect, scoutReport } from '../../engine/scouting';
import { passerRating } from '../../engine/stats';
import type { League, Player, StatLine } from '../../engine/types';
import { MAX_COMPARE, useNav } from '../App';
import { PlayerAvatar, useBackdropClose } from '../components';
import { ContractActions, ContractSummary, ContractYears, contractLabel } from '../contracts';
import { band, heightFt } from '../format';
import { AttributeList, CombinePanel, DevelopmentChart, KnowledgeMeter, potentialText, ScoutButton, StarScaleToggle, Stars, starsOf, useStarScale, viewOf } from '../scouting';

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
  const view = viewOf(league, p);
  const [scale, setScale] = useStarScale();
  const stars = starsOf(league, p, scale, view);
  const report = scoutReport(league, league.userTeamId, p);
  const comparing = nav.compareIds.includes(p.id);
  const cols = statColumns(p);
  const seasons = Object.keys(p.stats)
    .map(Number)
    .sort((a, b) => b - a);

  const backdrop = useBackdropClose(onClose);
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
    <div className="overlay" {...backdrop}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={`${p.firstName} ${p.lastName}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head" style={{ background: team?.colors[0] ?? '#333', boxShadow: `inset 0 -6px 0 ${team?.colors[1] ?? '#666'}` }}>
          <PlayerAvatar player={p} team={team} size={64} />
          <span className="jersey">{p.jersey}</span>
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {POSITION_NAMES[p.position]}
              {team ? ` · ${team.city} ${team.name}` : isProspect(p) ? ' · Draft prospect' : ' · Free agent'}
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
              <span className="eyebrow">{view.exact ? 'Overall' : 'Overall (scouted)'}</span>
              <b className={`num ${band(view.ovr)}`}>{view.exact ? view.ovr.toFixed(1) : `${view.ovrLo.toFixed(1)}–${view.ovrHi.toFixed(1)}`}</b>
            </span>
            <span className="fact stars-fact">
              <span className="eyebrow">Stars · {stars.basis}</span>
              <Stars s={stars} size={22} />
            </span>
            <span className="fact">
              <span className="eyebrow">Potential</span>
              <b className="num">{potentialText(view)}</b>
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
              <b className="num">{isProspect(p) ? 'Prospect' : p.experience === 0 ? 'Rookie' : `${p.experience} yr`}</b>
            </span>
            {!view.exact && (
              <span className="fact">
                <span className="eyebrow">Known</span>
                <KnowledgeMeter value={view.knowledge} />
              </span>
            )}
          </div>

          <div className="card-actions">
            <StarScaleToggle scale={scale} onChange={setScale} />
            <button className="btn btn-sm" aria-pressed={comparing} disabled={!comparing && nav.compareIds.length >= MAX_COMPARE} onClick={() => nav.toggleCompare(p.id)}>
              {comparing ? 'In comparison ✓' : 'Compare'}
            </button>
            {!view.exact && (
              <>
                <ScoutButton league={league} player={p} label="Send a scout" />
                <span className="muted small">{league.scoutPoints} visits left this year</span>
              </>
            )}
          </div>

          <p className="report">
            <span className="eyebrow">Scout's report</span>
            {report.join(' ')}
          </p>

          <section className="stack" aria-label="Ratings">
            <h3 style={{ margin: 0 }}>Ratings at {p.position}</h3>
            <AttributeList player={p} view={view} />
            <p className="muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
              Bold ratings make up his overall at {p.position}; tap any rating to see what it does in a game. Scale: 1–5 poor, 6–10 backup, 11–15 starter, 16–20 elite.
              {view.exact ? ' Arrows show the change since last season.' : ' Ranges are your scouts’ estimates; film and scouting visits narrow them.'}
            </p>
          </section>

          <section className="stack" aria-label="Development">
            <h3 style={{ margin: 0 }}>Development{view.exact ? '' : ' (as your scouts see it)'}</h3>
            <DevelopmentChart league={league} player={p} />
          </section>

          <section className="stack" aria-label="Combine">
            <h3 style={{ margin: 0 }}>Combine</h3>
            <CombinePanel player={p} />
          </section>

          {!isProspect(p) && (
            <section className="stack" aria-label="Contract">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Contract</h3>
                  <span className="muted small">{contractLabel(league, p)}</span>
                </div>
                <ContractActions league={league} player={p} />
              </div>
              <ContractSummary league={league} player={p} />
              <ContractYears player={p} />
            </section>
          )}

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
