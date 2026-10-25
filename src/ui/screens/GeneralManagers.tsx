import { editGmName, gmNameProblem } from '../../engine/gm';
import { store } from '../store';
import { GmJobs, LeadershipReports } from './GmEmployment';
import { useState } from 'react';
import { formatRecord, gmRecord, winPct } from '../../engine/records';
import type { Coach, GeneralManager, League } from '../../engine/types';
import { Panel, Section, Sheet, SortTh, sortRows, TeamLink, useSort } from '../components';
import { GmAvatar, gmDate, GmLink, gmName, gmStatus, gmStyleNotes } from '../gm';
import { CoachLink, OwnerMandates } from './Coaches';

export function gmHeadCoaches(league: League, gm: GeneralManager): { coach: Coach; seasons: number[] }[] {
  const people = [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)];
  return people
    .flatMap((coach) => {
      const seasons = new Set<number>();
      for (const cs of coach.career ?? []) {
        if (cs.role !== 'headCoach') continue;
        if (
          gm.career.some(
            (s) =>
              s.teamId === cs.teamId &&
              s.season === cs.season &&
              (s.record?.fromWeek ?? 1) <= (cs.record?.throughWeek ?? Infinity) &&
              (cs.record?.fromWeek ?? 1) <= (s.record?.throughWeek ?? Infinity),
          )
        )
          seasons.add(cs.season);
      }
      // Opening incumbents have no game record yet, but their current head coach is known.
      if (gm.teamId !== null && coach.teamId === gm.teamId && coach.role === 'headCoach') seasons.add(league.season);
      return seasons.size ? [{ coach, seasons: [...seasons].sort((a, b) => a - b) }] : [];
    })
    .sort((a, b) => Math.max(...b.seasons) - Math.max(...a.seasons));
}

function CareerFigures({ league, gm }: { league: League; gm: GeneralManager }) {
  const record = gmRecord(league, gm);
  return (
    <div className="gm-figures">
      <div>
        <span className="eyebrow">Regular season</span>
        <b className="num">{formatRecord(record.regular)}</b>
      </div>
      <div>
        <span className="eyebrow">Playoff trips</span>
        <b className="num">{record.playoffTrips}</b>
      </div>
      <div>
        <span className="eyebrow">Titles</span>
        <b className="num">{record.titles}</b>
      </div>
    </div>
  );
}

const DEPARTURES = {
  dismissed: 'Dismissed',
  expired: 'Contract ended',
  retired: 'Retired',
  permanent: 'Offered permanent job',
} as const;

function GmNameEditor({league, gm, onDone}: {league:League;gm:GeneralManager;onDone:()=>void}) {
  const [first, setFirst] = useState(gm.firstName), [last, setLast] = useState(gm.lastName);
  const problem = gmNameProblem(league, gm.id, first, last);
  return <form className="identity-edit" aria-label="Edit your GM name" onSubmit={(e) => {
    e.preventDefault(); if (problem) return;
    store.mutate((l) => editGmName(l, gm.id, first, last)); onDone();
  }}>
    <label><span className="eyebrow">First name</span><input autoFocus className="text-input" value={first} maxLength={24} onChange={(e)=>setFirst(e.target.value)} /></label>
    <label><span className="eyebrow">Last name</span><input className="text-input" value={last} maxLength={24} onChange={(e)=>setLast(e.target.value)} /></label>
    <div className="row"><button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>Cancel</button><button className="btn btn-sm btn-primary" disabled={!!problem}>Save name</button></div>
    {problem && <p className="muted small">{problem}</p>}
  </form>;
}

export function GmCard({ league, gm, onClose }: { league: League; gm: GeneralManager; onClose: () => void }) {
  const [editingName, setEditingName] = useState(false);
  const team = gm.teamId === null ? null : league.teams[gm.teamId];
  const current = gm.appointments.at(-1);
  const record = gmRecord(league, gm);
  const coaches = gmHeadCoaches(league, gm);
  const you = gm.id === league.userGmId;
  return (
    <Sheet
      label={gmName(gm)}
      team={team}
      onClose={onClose}
      head={
        <>
          <GmAvatar league={league} gm={gm} size={128} />
          <div className="gm-card-heading">
            <span className="eyebrow">General manager {you && <span className="gm-you">You</span>}</span>
            <h2>{gmName(gm)}</h2>
            <span>{team ? `${team.city} ${team.name}` : gmStatus(gm)}</span>
          </div>
        </>
      }
    >
      {you && <Section id="gm-name" title="Your GM name">
        {editingName ? <GmNameEditor league={league} gm={gm} onDone={()=>setEditingName(false)} /> : <button className="btn btn-sm" onClick={()=>setEditingName(true)}>Edit your GM name</button>}
      </Section>}
      <div className="facts gm-profile-facts">
        <span className="fact">
          <span className="eyebrow">Status</span>
          <b>{gmStatus(gm)}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Age</span>
          <b className="num">{gm.age}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">GM seasons recorded</span>
          <b className="num">{new Set(record.seasons.map((s) => s.season)).size}</b>
        </span>
        {team && current && (
          <span className="fact">
            <span className="eyebrow">Contract</span>
            <b>{current.through < league.season ? 'Review due' : `Through ${current.through}`}</b>
          </span>
        )}
      </div>
      <CareerFigures league={league} gm={gm} />
      {team && <OwnerMandates league={league} teamId={team.id} />}
      <Section id="gm-approach" title={you ? 'Your approach' : 'Public perception'}>
        <div className="gm-style-notes">
          {gmStyleNotes(league, gm).map((note) => (
            <p key={note}>
              {note}
            </p>
          ))}
        </div>
      </Section>
      <Section id="gm-appointments" title="GM appointments">
        <ol className="gm-timeline">
          {[...gm.appointments].reverse().map((a, i) => (
            <li key={`${a.teamId}:${a.start.season}:${a.start.week}:${i}`}>
              <div className="gm-timeline-title">
                <TeamLink team={league.teams[a.teamId]} chip full />
                <span className="tag-pill">{a.interim ? 'Interim' : 'Permanent'}</span>
              </div>
              <p className="muted small">
                {gm.origin === 'opening' && i === gm.appointments.length - 1 ? 'Recorded from ' : ''}
                {gmDate(a.start)} → {a.end ? gmDate(a.end) : 'Present'}
              </p>
              {a.reason && <span className="small">{DEPARTURES[a.reason]}</span>}
            </li>
          ))}
        </ol>
      </Section>
      <Section id="gm-results" title="Season by season">
        {record.seasons.length ? (
          <div className="table-scroll">
            <table className="small gm-history-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Team</th>
                  <th className="num">Record</th>
                  <th>Postseason</th>
                </tr>
              </thead>
              <tbody>
                {record.seasons.map((s) => (
                  <tr key={`${s.season}:${s.teamId}`}>
                    <td className="num">{s.season}</td>
                    <td>
                      <TeamLink team={league.teams[s.teamId]} />
                    </td>
                    <td className="num">{formatRecord(s.regular)}</td>
                    <td className={s.champion ? 'tone-good' : 'muted'}>
                      {s.finish}
                      {s.playoffs ? ` (${s.playoffs.w}–${s.playoffs.l})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">
            No GM games recorded yet. Earlier results are not attributed to this appointment.
          </p>
        )}
      </Section>
      {coaches.length > 0 && (
        <Section id="gm-coaches" title="Head coaches during this career">
          <ul className="gm-coaches">
            {coaches.map(({ coach, seasons }) => (
              <li key={coach.id}>
                <CoachLink c={coach} avatar />
                <span className="muted small">{seasons.join(', ')}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {gm.scouting && (
        <Section id="gm-scouting" title="Path through scouting">
          {gm.scouting.appointments?.length ? (
            <ol className="gm-timeline">
              {[...gm.scouting.appointments].reverse().map((a, i) => (
                <li key={i}>
                  <div className="gm-timeline-title">
                    <b>
                      {a.role === 'director'
                        ? 'Scouting director'
                        : a.role === 'collegeScout'
                          ? 'College scout'
                          : 'Pro scout'}
                    </b>
                    <TeamLink team={league.teams[a.teamId]} />
                  </div>
                  <p className="muted small">
                    {gmDate(a.start)}
                    {a.end ? ` → ${gmDate(a.end)}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted small">
              Promoted from scouting director. Earlier scouting appointments are not recorded.
            </p>
          )}
        </Section>
      )}
    </Sheet>
  );
}

type GmSort = 'name' | 'team' | 'status' | 'age' | 'since' | 'record';
type Filter = 'all' | 'employed' | 'unemployed' | 'retired';

export function GeneralManagers({ league }: { league: League }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, onSort] = useSort<GmSort>({ key: 'name', desc: false });
  const you = league.gms[league.userGmId];
  const people = Object.values(league.gms);
  const records = new Map(people.map((gm) => [gm.id, gmRecord(league, gm)]));
  const rows = sortRows(
    people.filter(
      (gm) =>
        filter === 'all' ||
        (filter === 'employed'
          ? gm.teamId !== null
          : filter === 'retired'
            ? gm.retired
            : gm.teamId === null && !gm.retired),
    ),
    sort,
    (gm, key) => {
      switch (key) {
        case 'name':
          return `${gm.lastName} ${gm.firstName}`;
        case 'team':
          return gm.teamId === null ? gmStatus(gm) : league.teams[gm.teamId].city;
        case 'status':
          return gmStatus(gm);
        case 'age':
          return gm.age;
        case 'since':
          return gm.appointments.at(-1)?.start.season ?? 0;
        case 'record':
          return records.get(gm.id)!.seasons.length ? winPct(records.get(gm.id)!.regular) : -1;
      }
    },
  );
  const filters: [Filter, string][] = [
    ['all', 'All GMs'],
    ['employed', 'In a job'],
    ['unemployed', 'Between jobs'],
    ['retired', 'Retired'],
  ];
  return (
    <div className="stack">
      <GmJobs league={league} />
      <LeadershipReports league={league} />
      <Panel className="gm-career-overview" title="Your GM career">
        <div className="gm-overview-person">
          <GmAvatar league={league} gm={you} size={88} />
          <div>
            <span className="eyebrow">{gmStatus(you)}</span>
            <h2>
              <GmLink league={league} gm={you} />
            </h2>
            <span className="muted">
              {you.teamId !== null ? (
                <TeamLink team={league.teams[you.teamId]} full />
              ) : (
                'Your career continues in this league.'
              )}
            </span>
          </div>
        </div>
        <CareerFigures league={league} gm={you} />
      </Panel>
      <Panel
        title={
          <div>
            <h2>General managers</h2>
            <p className="muted small gm-directory-intro">
              The people building the league. Open a name for appointments, results and scouting history.
            </p>
          </div>
        }
      >
        <div className="seg gm-filters" role="group" aria-label="GM employment">
          {filters.map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}{' '}
              <span className="muted">
                {key === 'all'
                  ? people.length
                  : key === 'employed'
                    ? people.filter((g) => g.teamId !== null).length
                    : key === 'retired'
                      ? people.filter((g) => g.retired).length
                      : people.filter((g) => g.teamId === null && !g.retired).length}
              </span>
            </button>
          ))}
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="gm-directory-table">
              <thead>
                <tr>
                  <SortTh label="GM" k="name" sort={sort} onSort={onSort} desc={false} />
                  <SortTh label="Team" k="team" sort={sort} onSort={onSort} desc={false} />
                  <SortTh label="Status" k="status" sort={sort} onSort={onSort} desc={false} />
                  <SortTh label="Age" k="age" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Recorded from" k="since" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Record" k="record" sort={sort} onSort={onSort} className="num" />
                </tr>
              </thead>
              <tbody>
                {rows.map((gm) => (
                  <tr key={gm.id} className={gm.id === league.userGmId ? 'is-user' : undefined}>
                    <td>
                      <GmLink league={league} gm={gm} avatar />
                      {gm.id === league.userGmId && <span className="tag-pill gm-you-inline">You</span>}
                    </td>
                    <td>
                      {gm.teamId === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <TeamLink team={league.teams[gm.teamId]} chip />
                      )}
                    </td>
                    <td>
                      <span
                        className={`tag-pill${gm.appointments.at(-1)?.interim && gm.teamId !== null ? ' tag-warn' : ''}`}
                      >
                        {gmStatus(gm)}
                      </span>
                    </td>
                    <td className="num">{gm.age}</td>
                    <td className="num">{gm.appointments.at(-1)?.start.season ?? '—'}</td>
                    <td className="num">
                      {records.get(gm.id)!.seasons.length ? (
                        formatRecord(records.get(gm.id)!.regular)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted gm-empty">
            {filter === 'unemployed'
              ? 'No GMs are between jobs right now.'
              : filter === 'retired'
                ? 'No retired GMs are recorded yet.'
                : 'No GMs match this view.'}
          </p>
        )}
      </Panel>
    </div>
  );
}
