import { useEffect, useRef, useState } from 'react';
import { honorBadges, playerHonors } from '../../engine/awards';
import { POSITION_NAMES } from '../../engine/positions';
import { careerOutlook, FIXED_HEADING, fixedHabits, habitChangeText, habitTimeline, isProspect, scoutReport, type PlayerView } from '../../engine/scouting';
import { formNote } from '../../engine/quirks';
import { FOCUS_LABEL, FOCUS_OF, ROLE_LABEL, staffName } from '../../engine/staff';
import { editPlayerIdentity, identityProblem } from '../../engine/roster';
import { careerLine, passerRating } from '../../engine/stats';
import { consensusRank } from '../../engine/offseason/draft';
import type { League, Player, StatLine } from '../../engine/types';
import { MAX_COMPARE, useNav } from '../App';
import { playerCoachLine } from '../coaching';
import { Exact, PlayerAvatar, Section, Sheet } from '../components';
import { LinkedText, type Who } from '../moves';
import { store } from '../store';
import { ContractActions, ContractSummary, ContractYears, contractLabel } from '../contracts';
import { band, heightFt } from '../format';
import { HealthSection } from '../injuries';
import { coachOfPlayer, coachTitle, teamScheme } from '../../engine/coaching';
import { spotsFor } from '../../engine/schemes';
import { AttributeList, CombinePanel, DevelopmentChart, KnowledgeMeter, MakeupPills, makeupOf, potentialText, QuirkPills, quirksOf, repsOf, ScoutButton, StarScaleToggle, Stars, schemeFitOf, starsOf, useStarScale, viewOf } from '../scouting';

type Col = [label: string, value: (s: StatLine) => string | number];

/** Where he went in the draft and how the consensus read him then (or now, for a prospect). */
function DraftLine({ league, player: p }: { league: League; player: Player }) {
  const c = p.scouting;
  const read = c ? `grade ${c.grade.toFixed(1)}, ceiling ${c.ceiling.toFixed(1)}` : '';
  if (isProspect(p))
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {league.season} draft class: consensus #{consensusRank(league, p)} ({read}).
      </p>
    );
  const d = p.draft;
  if (!d) return null;
  return (
    <p className="muted small" style={{ margin: 0 }}>
      Drafted {d.season}: round {d.round}, No. {d.pick} by {league.teams[d.teamId].abbrev}.
      {c && ` Consensus${d.rank !== undefined ? ` #${d.rank}` : ''} at the time: ${read}.`}
    </p>
  );
}

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
        ['Roughed', n('roughingDrawn')],
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
        ['Pen', n('penalties')],
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
      return [
        ['Sacks alw', n('sacksAllowed')],
        ['Press alw', n('pressuresAllowed')],
        ['Hits alw', n('hitsAllowed')],
        ['Pen', n('penalties')],
      ];
    case 'DT':
    case 'EDGE':
      return [
        ['Tkl', n('tackles')],
        ['TFL', n('tfl')],
        ['Sacks', n('sacks')],
        ['Press', n('pressures')],
        ['QB hits', n('qbHits')],
        ['FF', n('forcedFum')],
        ['Pen', n('penalties')],
      ];
    default:
      return [
        ['Tkl', n('tackles')],
        ['TFL', n('tfl')],
        ['Sacks', n('sacks')],
        ['INT', n('defInt')],
        ['PD', n('passDef')],
        ['FF', n('forcedFum')],
        ['Pen', n('penalties')],
      ];
  }
}

/** "every one of", "most of", "about half of", "a few of": playing time in words. */
const shareWords = (share: number) => (share >= 0.99 ? 'every one of' : share >= 0.75 ? 'most of' : share >= 0.4 ? 'about half of' : 'a few of');

/** Who in your scouting department sized up this player: the name behind the range, a link to his card. */
function ReadBy({ league, view, p }: { league: League; view: PlayerView; p: Player }) {
  const nav = useNav();
  const who = (id: number | null) => {
    const s = id === null ? undefined : league.staff[id];
    // A scout can be the best reader available for a group he doesn't specialise in; say so.
    return s ? (
      <>
        <button className="linklike" onClick={() => nav.openStaff('scout', s.id)}>
          {staffName(s)}
        </button>
        , {ROLE_LABEL[s.role].toLowerCase()}
        {s.focus ? ` (${FOCUS_LABEL[s.focus]}${s.focus === FOCUS_OF[p.position] ? '' : ', off his specialty'})` : ''}
      </>
    ) : null;
  };
  const reader = who(view.readerId);
  if (!reader) return <>Nobody reads him: your Director’s chair is empty.</>;
  // Only players still growing get a ceiling read; past 25 it's just his overall.
  const ceiling = p.age < 26 && view.potReaderId !== view.readerId ? who(view.potReaderId) : null;
  return (
    <>
      Read by {reader}.{ceiling && <> Ceiling read by {ceiling}.</>}
    </>
  );
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

/** A player's stats by season (a season split by a trade shows each team's share under it) and his career line. */
export function StatsTable({ league, player: p }: { league: League; player: Player }) {
  const cols = statColumns(p);
  const seasons = Object.keys(p.stats)
    .map(Number)
    .sort((a, b) => b - a);
  if (!cols.length || !seasons.length) return null;
  const careerTeams = [...new Set(seasons.flatMap((s) => seasonTeams(p, s)))];
  return (
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
  );
}

export function PlayerCard({ league, player: p, onClose }: { league: League; player: Player; onClose: () => void }) {
  const nav = useNav();
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  const view = viewOf(league, p);
  const draftDay = isProspect(p) || (league.phase === 'draft' && p.draft?.season === league.season);
  const [scale, setScale] = useStarScale();
  const stars = starsOf(league, p, scale, view);
  const report = scoutReport(league, league.userTeamId, p);
  const makeup = makeupOf(league, p);
  const habits = quirksOf(league, p);
  const form = formNote(league, p);
  const fixed = fixedHabits(league, league.userTeamId, p);
  const timeline = habitTimeline(league, league.userTeamId, p).slice(0, 5);
  const reps = repsOf(league, p);
  // Film reveals a veteran's makeup over time; for anyone else a scouting visit (a sit-down) is the way.
  const sitDownHint = !makeup.known && p.teamId !== league.userTeamId && !p.retired && league.scoutPoints > 0;
  const comparing = nav.compareIds.includes(p.id);
  const cols = statColumns(p);
  const honors = honorBadges(playerHonors(league, p.id));
  const coach = p.retired ? coachOfPlayer(league, p.id) : undefined;
  const seasons = Object.keys(p.stats)
    .map(Number)
    .sort((a, b) => b - a);

  const [editing, setEditing] = useState(false);
  // His starting spot in his team's schemes (LT, SLOT, NT…), if he starts.
  const spot = team ? spotsFor(teamScheme(league, team.id), p.position)[team.depthChart[p.position].indexOf(p.id)] : undefined;
  // How he'd fit what your coordinators run (a free agent, a prospect or a rival's player alike).
  const myScheme = teamScheme(league, league.userTeamId);
  const fit = p.retired ? null : schemeFitOf(league, p, myScheme);
  // His coaches' line shows for your own players; the coaches named in it open their cards.
  const coachLine = p.teamId === league.userTeamId && !p.retired ? playerCoachLine(league, p) : null;
  const coachWho = coachLine?.coaches.map((c): Who => ({ kind: 'coach', id: c.id }));
  const fitSide = ['QB', 'RB', 'WR', 'TE', 'OL'].includes(p.position) ? 'offense' : 'defense';
  const fitScheme = fitSide === 'offense' ? myScheme.offense.label : [myScheme.front.label, myScheme.coverage?.label].filter(Boolean).join(' · ');

  return (
    <Sheet
      label={`${p.firstName} ${p.lastName}`}
      team={team}
      onClose={onClose}
      head={
        <>
          <PlayerAvatar player={p} team={team} size={64} />
          <span className="jersey">{p.jersey}</span>
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {spot ? `${spot} · ` : ''}
              {POSITION_NAMES[p.position]}
              {team ? ` · ${team.city} ${team.name}` : isProspect(p) ? ' · Draft prospect' : p.retired ? ' · Retired' : ' · Free agent'}
            </span>
            <h2 style={{ fontSize: 'var(--step-3)' }}>
              {p.firstName} {p.lastName}
            </h2>
          </div>
        </>
      }
      actions={
        <button className="edit-x" onClick={() => setEditing((v) => !v)} aria-label="Edit name and number" aria-pressed={editing} title="Edit name and number">
          ✎
        </button>
      }
    >
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
            <span className="fact">
              <span className="eyebrow">Habits</span>
              {!habits.known ? (
                <span className="muted">Unknown</span>
              ) : habits.notes.length === 0 ? (
                <span className="muted">None on film</span>
              ) : (
                <QuirkPills notes={habits.notes} />
              )}
              {(['bad', 'good', 'style'] as const).map((tone) => {
                const left = fixed.filter((f) => f.tone === tone);
                // Your own players hide nothing: no "seems" about it.
                const heading = view.exact && tone === 'bad' ? 'Has fixed' : FIXED_HEADING[tone];
                return left.length ? (
                  <span key={tone} className="muted small">
                    {heading}: {left.map((f) => f.label).join(', ')}
                  </span>
                ) : null;
              })}
            </span>
            {form && (
              <span className="fact">
                <span className="eyebrow">Form</span>
                <span className="tone-bad">{form}</span>
              </span>
            )}
            {fit && (
              <span className="fact" title={`Your ${fitSide} leans on ${fit.skills.join(', ')}${view.exact ? '' : ' (as your scouts read him)'}.`}>
                <span className="eyebrow">Fit · {fitScheme}</span>
                <span className={fit.grade === 'Poor' ? 'tone-bad' : fit.grade === 'Ideal' ? 'tone-good' : undefined}>
                  {fit.grade}
                  <span className="muted small"> · {fit.skills.join(', ')}</span>
                </span>
              </span>
            )}
            {!view.exact && (
              <span className="fact">
                <span className="eyebrow">Known</span>
                <KnowledgeMeter value={view.knowledge} />
              </span>
            )}
          </div>

          {coach && (
            <p className="small" style={{ margin: 0 }}>
              {league.coaches[coach.id] ? 'Now coaching: ' : 'Went on to coach: '}
              <button className="linklike" onClick={() => nav.openStaff('coach', coach.id)}>
                {coachTitle(coach)}
                {coach.teamId !== null ? `, ${league.teams[coach.teamId].abbrev}` : league.coaches[coach.id] ? ', on the market' : ' (retired)'}
              </button>
            </p>
          )}
          {honors.length > 0 && (
            <div className="pill-row" aria-label="Honors">
              {honors.map((h) => (
                <span key={h.label} className="tag-pill tag-good" title={`${h.label}: ${h.seasons.join(', ')}`}>
                  {h.seasons.length > 1 ? `${h.seasons.length}× ${h.label}` : `${h.seasons[0]} ${h.label}`}
                </span>
              ))}
            </div>
          )}

          {timeline.length > 0 && (
            <Section id="habits" title="Habits over time" defaultOpen={false} className="muted small">
              <ul className="habit-timeline">
                {timeline.map((e) => (
                  <li key={`${e.id}-${e.season}-${e.week}-${e.change}`}>
                    <span className="num">
                      {e.season}
                      {e.week ? `, wk ${e.week}` : ', offseason'}
                    </span>
                    {' · '}
                    {habitChangeText(e)}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!view.exact && (
            <p className="muted small read-by">
              <ReadBy league={league} view={view} p={p} />
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

          {!isProspect(p) && <HealthSection league={league} player={p} />}

          <Section id="ratings" title={`Ratings at ${p.position}`}>
            <AttributeList player={p} view={view} />
            <p className="muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
              Bold ratings make up his overall at {p.position}; tap any rating to see what it does in a game. Scale: 1–5 poor, 6–10 backup, 11–15 starter, 16–20 elite.
              {view.exact ? ' Arrows show the change since last season.' : ' Ranges are your scouts’ estimates; film and scouting visits narrow them.'}
            </p>
          </Section>

          <Section id="development" title={`Development${view.exact ? '' : ' (as your scouts see it)'}`}>
            <DevelopmentChart league={league} player={p} />
            <p className="muted small" style={{ margin: 0 }}>
              {careerOutlook(league, league.userTeamId, p)}
            </p>
            {coachLine && (
              <div className="muted small">
                <Exact numbers={<LinkedText league={league} text={coachLine.numbers} about={coachWho} />}>
                  <LinkedText league={league} text={coachLine.text} about={coachWho} />
                </Exact>
              </div>
            )}
            {reps && (
              <p className="muted small" style={{ margin: 0 }}>
                {reps.share > 0 ? `Played in ${shareWords(reps.share)} his team’s games in ${reps.season}.` : `Has not played in any of his team’s games in ${reps.season}.`}
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
          </Section>

          {/* Open while he's on the board (or just off it); a settled pro's draft day folds away. Each keeps its own fold. */}
          <Section key={draftDay ? 'draft-open' : 'draft'} id={draftDay ? 'draft-open' : 'draft'} title="Draft & combine" defaultOpen={draftDay}>
            <DraftLine league={league} player={p} />
            <CombinePanel player={p} />
          </Section>

          {!isProspect(p) && (
            <Section id="contract" title="Contract">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted small">{contractLabel(league, p)}</span>
                <ContractActions league={league} player={p} />
              </div>
              <ContractSummary league={league} player={p} />
              <ContractYears player={p} />
            </Section>
          )}

          {cols.length > 0 && seasons.length > 0 && (
            <Section id="stats" title="Stats">
              <StatsTable league={league} player={p} />
            </Section>
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
    </Sheet>
  );
}
