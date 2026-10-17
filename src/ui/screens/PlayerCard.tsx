import { useEffect, useRef, useState } from 'react';
import { honorBadges, playerHonors } from '../../engine/awards';
import { POSITION_NAMES } from '../../engine/positions';
import { careerOutlook, isProspect, scoutReport, type PlayerView } from '../../engine/scouting';
import { FOCUS_LABEL, FOCUS_OF, ROLE_LABEL, staffName } from '../../engine/staff';
import { editPlayerIdentity, identityProblem } from '../../engine/roster';
import { careerLine, passerRating } from '../../engine/stats';
import type { League, Player, StatLine } from '../../engine/types';
import { MAX_COMPARE, useNav } from '../App';
import { playerCoachLine } from '../coaching';
import { PlayerAvatar, useBackdropClose } from '../components';
import { store } from '../store';
import { ContractActions, ContractSummary, ContractYears, contractLabel } from '../contracts';
import { band, heightFt } from '../format';
import { AttributeList, CombinePanel, DevelopmentChart, KnowledgeMeter, MakeupPills, makeupOf, potentialText, repsOf, ScoutButton, StarScaleToggle, Stars, starsOf, useStarScale, viewOf } from '../scouting';

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

/** Who in your scouting department sized up this player: the name behind the range. */
function readByText(league: League, view: PlayerView, p: Player): string {
  const who = (id: number | null) => {
    const s = id === null ? undefined : league.staff[id];
    // A scout can be the best reader available for a group he doesn't specialise in; say so.
    return s ? `${staffName(s)}, ${ROLE_LABEL[s.role].toLowerCase()}${s.focus ? ` (${FOCUS_LABEL[s.focus]}${s.focus === FOCUS_OF[p.position] ? '' : ', off his specialty'})` : ''}` : null;
  };
  const reader = who(view.readerId);
  if (!reader) return 'Nobody reads him: your Director’s chair is empty.';
  // Only players still growing get a ceiling read; past 25 it's just his overall.
  const ceiling = p.age < 26 && view.potReaderId !== view.readerId ? who(view.potReaderId) : null;
  return `Read by ${reader}.${ceiling ? ` Ceiling read by ${ceiling}.` : ''}`;
}

/** Rename or renumber a player. Cosmetic, so any player can be edited (a roster mod does the same in bulk). */
function IdentityEditor({ league, player: p, onDone }: { league: League; player: Player; onDone: () => void }) {
  const [firstName, setFirst] = useState(p.firstName);
  const [lastName, setLast] = useState(p.lastName);
  const [jersey, setJersey] = useState(String(p.jersey));
  const edit = { firstName, lastName, jersey: jersey.trim() === '' ? NaN : Number(jersey) };
  const problem = identityProblem(league, p, edit);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  return (
    <form
      className="identity-edit"
      aria-label="Edit name and number"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return;
        store.mutate((l) => editPlayerIdentity(l, p.id, edit));
        onDone();
      }}
    >
      <label>
        <span className="eyebrow">First name</span>
        <input ref={firstRef} className="text-input" value={firstName} maxLength={24} onChange={(e) => setFirst(e.target.value)} />
      </label>
      <label>
        <span className="eyebrow">Last name</span>
        <input className="text-input" value={lastName} maxLength={24} onChange={(e) => setLast(e.target.value)} />
      </label>
      <label>
        <span className="eyebrow">Number</span>
        <input className="text-input jersey-input" inputMode="numeric" value={jersey} maxLength={2} onChange={(e) => setJersey(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="row" style={{ gap: 8, alignSelf: 'end' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!!problem} title={problem ?? undefined}>
          Save
        </button>
      </div>
      {problem && <p className="small muted" style={{ margin: 0, gridColumn: '1 / -1' }}>{problem}</p>}
    </form>
  );
}

/** The teams a season's stats were earned for, in order; empty when an old save doesn't know. */
function seasonTeams(p: Player, season: number): number[] {
  return p.statTeams?.[season] ?? [];
}

/** One stats row; the team shows as its abbreviation, "2 teams" for a split season, or a dash when unknown. */
function StatRow({ league, label, teamIds, line, cols, total }: { league: League; label: string; teamIds: number[]; line: StatLine; cols: Col[]; total?: boolean }) {
  const teamText = teamIds.length === 0 ? '–' : teamIds.length === 1 ? league.teams[teamIds[0]].abbrev : `${teamIds.length} teams`;
  const one = teamIds.length === 1 ? league.teams[teamIds[0]] : null;
  return (
    <tr className={total ? 'stat-total' : undefined}>
      <td className="num">{label}</td>
      <td>
        {one ? (
          <span className="team-tag" style={{ borderColor: one.colors[0] }} title={`${one.city} ${one.name}`}>
            {teamText}
          </span>
        ) : (
          <span className="muted">{teamText}</span>
        )}
      </td>
      <td className="num">{line.gp ?? 0}</td>
      {cols.map(([colLabel, f]) => (
        <td key={colLabel} className="num">
          {f(line)}
        </td>
      ))}
    </tr>
  );
}

export function PlayerCard({ league, player: p, onClose }: { league: League; player: Player; onClose: () => void }) {
  const nav = useNav();
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  const view = viewOf(league, p);
  const [scale, setScale] = useStarScale();
  const stars = starsOf(league, p, scale, view);
  const report = scoutReport(league, league.userTeamId, p);
  const makeup = makeupOf(league, p);
  const reps = repsOf(league, p);
  // Film reveals a veteran's makeup over time; for anyone else a scouting visit (a sit-down) is the way.
  const sitDownHint = !makeup.known && p.teamId !== league.userTeamId && !p.retired && league.scoutPoints > 0;
  const comparing = nav.compareIds.includes(p.id);
  const cols = statColumns(p);
  const honors = honorBadges(playerHonors(league, p.id));
  const seasons = Object.keys(p.stats)
    .map(Number)
    .sort((a, b) => b - a);

  const [editing, setEditing] = useState(false);
  const careerTeams = [...new Set(seasons.flatMap((s) => seasonTeams(p, s)))];

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
        <div className="sheet-head has-edit" style={{ background: team?.colors[0] ?? '#333', boxShadow: `inset 0 -6px 0 ${team?.colors[1] ?? '#666'}` }}>
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
          <button className="edit-x" onClick={() => setEditing((v) => !v)} aria-label="Edit name and number" aria-pressed={editing} title="Edit name and number">
            ✎
          </button>
          <button ref={closeRef} className="close-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {editing && <IdentityEditor league={league} player={p} onDone={() => setEditing(false)} />}
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
            <span className="fact">
              <span className="eyebrow">{makeup.known && makeup.hedged ? 'Makeup · early word' : 'Makeup'}</span>
              {!makeup.known ? (
                <span className="muted">Unknown</span>
              ) : makeup.notes.length === 0 ? (
                <span className="muted">Nothing stands out</span>
              ) : (
                <MakeupPills notes={makeup.notes} hedged={makeup.hedged} />
              )}
            </span>
            {!view.exact && (
              <span className="fact">
                <span className="eyebrow">Known</span>
                <KnowledgeMeter value={view.knowledge} />
              </span>
            )}
          </div>

          {honors.length > 0 && (
            <div className="pill-row" aria-label="Honors">
              {honors.map((h) => (
                <span key={h.label} className="tag-pill tag-good" title={`${h.label}: ${h.seasons.join(', ')}`}>
                  {h.seasons.length > 1 ? `${h.seasons.length}× ${h.label}` : `${h.seasons[0]} ${h.label}`}
                </span>
              ))}
            </div>
          )}

          {!view.exact && (
            <p className="muted small read-by">
              {readByText(league, view, p)}
              {sitDownHint && ' A scouting visit doubles as a sit-down: it can take one or two to learn his makeup.'}
            </p>
          )}

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
            <p className="muted small" style={{ margin: 0 }}>
              {careerOutlook(league, league.userTeamId, p)}
            </p>
            {p.teamId === league.userTeamId && !p.retired && (
              <p className="muted small" style={{ margin: 0 }}>
                {playerCoachLine(league, p)}
              </p>
            )}
            {reps && (
              <p className="muted small" style={{ margin: 0 }}>
                {reps.share > 0 ? `Played in ${Math.round(reps.share * 100)}% of his team’s games in ${reps.season}.` : `Has not played in any of his team’s games in ${reps.season}.`}
                {reps.needs && (
                  <>
                    {' '}
                    <span className="tag-pill tag-warn" style={{ marginLeft: 0 }}>
                      Needs reps
                    </span>{' '}
                    Young players develop faster with snaps; sitting slows him down.
                  </>
                )}
              </p>
            )}
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
                    <th>Team</th>
                    <th className="num">GP</th>
                    {cols.map(([label]) => (
                      <th key={label} className="num">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasons.flatMap((season) => {
                    const teamIds = seasonTeams(p, season);
                    const split = p.splitStats?.[season];
                    const row = <StatRow key={season} league={league} label={String(season)} teamIds={teamIds} line={p.stats[season]} cols={cols} total={!!split} />;
                    if (!split) return [row];
                    // A season split by a trade: each team's share under the season total.
                    return [
                      row,
                      ...teamIds.map((id) => <StatRow key={`${season}-${id}`} league={league} label="" teamIds={[id]} line={split[id] ?? {}} cols={cols} />),
                    ];
                  })}
                  {seasons.length > 1 && <StatRow league={league} label="Career" teamIds={careerTeams} line={careerLine(p)} cols={cols} total />}
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
