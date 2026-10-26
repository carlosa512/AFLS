import { PublicPlayerCard } from './screens/PlayerCard';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { protectCoach, teamCoaches } from '../engine/coaching';
import { CoachCard, CoachesScreen } from './screens/Coaches';
import { appointDirectorAsGm, endGmAppointment } from '../engine/gm';
import { recordResult } from '../engine/league';
import type { Game, GameResult, GeneralManager } from '../engine/types';
import { gmLook, gmName, gmStatus, gmStyleNotes, GmAvatar } from './gm';
import { hashToRoute, routeToHash } from './routes';
import { GeneralManagers, GmCard, gmHeadCoaches } from './screens/GeneralManagers';
import { lookOf } from './staffAvatar';
import { staffLook } from './staffLook';
import { linkedSegments, moveIndex, nameIndex } from './moves';
import { leadershipNewYear } from '../engine/leadership';
import { GmJobs, LeadershipReports, PublicRoster } from './screens/GmEmployment';

const world = () => createLeague({ seed: 'gm-cards' });
const renderCard = (league: ReturnType<typeof world>, gm: GeneralManager) =>
  renderToStaticMarkup(<GmCard league={league} gm={gm} onClose={() => {}} />);

describe('GM cards and directory', () => {
  it('offers name editing only on the human card and describes other GMs through public perception', () => {
    const l = world();
    const own = renderCard(l, l.gms[l.userGmId]);
    expect(own).toContain('Edit your GM name');
    expect(own).toContain('✎'); // the same pencil as a player card, not a button inside the card
    expect(own).not.toContain('>Edit your GM name</button>');
    const other = renderCard(l, l.gms[l.teams[1].gmId!]);
    expect(other).not.toContain('Edit your GM name');
    expect(other).toContain('Public perception');
    expect(other).not.toContain('Internal staffing');
    const appointment = renderToStaticMarkup(<GmJobs league={l} />);
    expect(appointment).toContain('This is you');
    expect(appointment).toContain('gm-appointment-line');
    expect(appointment).not.toContain('hiring round');
  });
  it('shows the owner’s extension offer with accept and a decline that ends the job', () => {
    const l = world();
    l.phase = 'resign';
    l.gms[l.userGmId].appointments.at(-1)!.through = l.season - 1;
    delete l.leadership.search;
    leadershipNewYear(l);
    const html = renderToStaticMarkup(<GmJobs league={l} />);
    expect(html).toContain(`Extension through ${l.season + 2}`);
    expect(html).toContain('Accept the extension');
    expect(html).toContain('Decline and enter the job market');
    expect(html).not.toContain('Consider other openings');
    expect(html).not.toContain('GM position through');
  });
  it('keeps the interim takeover in a coach’s history after a permanent appointment', () => {
    const l = world();
    const c = teamCoaches(l, 1).find((c) => c.role === 'headCoach')!;
    c.interimAppointments = [{ season: l.season - 1, teamId: 1, week: 9 }];
    delete c.interim;
    const html = renderToStaticMarkup(<CoachCard league={l} coach={c} onClose={() => {}} />);
    expect(html).toContain('took over as interim head coach');
    expect(html).toContain('Week 9');
  });

  it('keeps other clubs’ owner instructions off GM and coach cards and uses qualified public reporting', () => {
    const l = world();
    const other = l.teams[1];
    const c = teamCoaches(l, other.id).find((c) => c.role === 'headCoach')!;
    protectCoach(l, c.id, l.season, 'PRIVATE exact staffing promise');
    l.leadership.events.push({
      id: 1,
      date: { season: l.season, phase: 'regular', week: 1 },
      teamId: 1,
      gmId: other.gmId!,
      kind: 'warning',
      report: 'Reports suggest the GM has a prove-it season.',
      privateText: 'PRIVATE exact staffing promise',
    });
    for (const html of [
      renderCard(l, l.gms[other.gmId!]),
      renderToStaticMarkup(<CoachCard league={l} coach={c} onClose={() => {}} />),
      renderToStaticMarkup(<LeadershipReports league={l} />),
    ])
      expect(html).not.toContain('PRIVATE');
    expect(renderToStaticMarkup(<LeadershipReports league={l} />)).toContain('Reports suggest');
    endGmAppointment(l, l.userGmId, 'dismissed');
    expect(renderToStaticMarkup(<GmJobs league={l} />)).toContain('Between GM jobs');
    const p = Object.values(l.players).find((p) => p.teamId === l.userTeamId)!;
    const card = renderToStaticMarkup(<PublicPlayerCard league={l} player={p} onClose={() => {}} />);
    expect(card).toContain('Public career results');
    expect(card).not.toContain('Scouting report');
    expect(renderToStaticMarkup(<PublicRoster league={l} teamId={l.userTeamId} />)).not.toContain('Release');
  });
  it('shows the signed owner commitment on both GM and coach views, with dismissal disabled', () => {
    const l = world();
    l.phase = 'resign';
    const coach = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    coach.contract!.through = l.season - 1;
    protectCoach(l, coach.id, l.season, 'Give this program another year.');
    for (const html of [
      renderCard(l, l.gms[l.userGmId]),
      renderToStaticMarkup(<CoachCard league={l} coach={coach} onClose={() => {}} />),
      renderToStaticMarkup(<CoachesScreen league={l} />),
    ]) {
      expect(html).toContain('Owner mandate');
      expect(html).toContain('Give this program another year.');
      expect(html).toContain('Already under contract');
    }
    const html = renderToStaticMarkup(<CoachesScreen league={l} />);
    expect(html).toMatch(new RegExp(`aria-label="Dismiss[^\"]*${coach.firstName} ${coach.lastName}" disabled=""`));
  });
  it('round-trips the GM directory route', () => {
    expect(routeToHash({ view: 'office', tab: 'gms' })).toBe('#/office/gms');
    expect(hashToRoute('#/office/gms')).toEqual({ view: 'office', tab: 'gms' });
  });

  it('shows the user’s identity and earned results without inventing an AI approach', () => {
    const l = world();
    const gm = l.gms[l.userGmId];
    const g = { id: l.nextGameId++, season: l.season, week: 1, homeId: 0, awayId: 1 } as Game;
    recordResult(l, g, { homeScore: 21, awayScore: 14, playerStats: {}, playerTeams: {} } as GameResult);
    const before = JSON.stringify(l);
    const html = renderCard(l, gm);
    expect(html).toContain(gmName(gm));
    expect(html).toContain('Permanent GM');
    expect(html).toContain('1–0');
    expect(html).toContain('Season in progress');
    expect(html).toContain('You set the roster strategy');
    expect(html).not.toContain(l.teams[0].gm.archetype);
    expect(JSON.stringify(l)).toBe(before);
  });

  it('renders employed, interim, between-jobs and retired states from actual appointments', () => {
    const l = world();
    const first = l.gms[l.teams[1].gmId!];
    const source = Object.values(l.staff).find((s) => s.teamId === 1 && s.role === 'director')!;
    endGmAppointment(l, first.id, 'dismissed');
    const unemployed = renderCard(l, first);
    expect(unemployed).toContain('Between jobs');
    expect(unemployed).toContain('Dismissed');
    expect(unemployed).not.toContain('Through 2028');
    const interim = appointDirectorAsGm(l, 1, source.id, { through: l.season, interim: true });
    const temporary = renderCard(l, interim);
    expect(temporary).toContain('Interim GM');
    expect(temporary).toContain('Path through scouting');
    expect(temporary).toContain('Scouting director');
    expect(temporary).not.toContain('College scout');
    endGmAppointment(l, interim.id, 'retired');
    expect(gmStatus(interim)).toBe('Retired');
    expect(renderCard(l, interim)).toContain('Retired');
  });

  it('lists every persistent person and marks the user in the directory', () => {
    const l = world();
    const html = renderToStaticMarkup(<GeneralManagers league={l} />);
    expect(html).toContain('Your GM career');
    expect(html).toContain('All GMs');
    expect(html).toContain('Recorded from');
    expect(html.match(/class="is-user"/g)).toHaveLength(1);
    for (const gm of Object.values(l.gms)) expect(html).toContain(gmName(gm));
  });

  it('does not describe a migrated incumbent’s observation date as a known hiring date', () => {
    const l = world();
    const html = renderCard(l, l.gms[l.teams[1].gmId!]);
    expect(html).toContain('Recorded from');
    expect(html).toContain('Earlier results are not attributed');
  });

  it('links GM names in text and supports explicit GM references', () => {
    const l = world();
    const gm = l.gms[l.userGmId];
    gm.firstName = 'Example';
    gm.lastName = 'Executive';
    expect(nameIndex(l).get(gmName(gm))).toEqual({ kind: 'gm', id: gm.id });
    expect(moveIndex(l).gm.get(gmName(gm))).toEqual({ kind: 'gm', id: gm.id });
    expect(linkedSegments(l, `Ask ${gmName(gm)}.`, [{ kind: 'gm', id: gm.id }])).toContainEqual({
      text: gmName(gm),
      who: { kind: 'gm', id: gm.id },
    });
  });

  it('only lists coaches whose actual service overlapped the GM’s service', () => {
    const l = world();
    const gm = l.gms[l.teams[0].gmId!];
    endGmAppointment(l, gm.id, 'dismissed');
    const coach = Object.values(l.coaches).find((c) => c.teamId === 0 && c.role === 'headCoach')!;
    const record = (fromWeek: number, throughWeek: number) => ({
      fromWeek,
      throughWeek,
      regular: { w: 0, l: 0, t: 0 },
      playoffs: null,
      champion: false,
    });
    gm.career = [{ season: l.season, teamId: 0, record: record(1, 6) }];
    coach.career = [{ season: l.season, teamId: 0, role: 'headCoach', record: record(7, 18) }];
    expect(gmHeadCoaches(l, gm).some((row) => row.coach.id === coach.id)).toBe(false);
    coach.career[0].record = record(4, 18);
    expect(gmHeadCoaches(l, gm)).toContainEqual({ coach, seasons: [l.season] });
  });
});

describe('GM portraits', () => {
  it('dresses every GM in a suit while keeping varied head shapes', () => {
    const l = world();
    const looks = Object.values(l.gms).map(gmLook);
    expect(new Set(looks.map((look) => look.garment))).toEqual(new Set(['blazer']));
    expect(new Set(looks.map((look) => look.head)).size).toBeGreaterThan(2);
    expect(looks.every((look) => look.headwear === 'none' && look.gear === 'none')).toBe(true);
  });

  it('keeps every established head and hair profile when the dress code changes', () => {
    const l = world();
    for (const gm of Object.values(l.gms)) {
      const before = staffLook(gm.appearanceId, 'gm', gm.woman === true, 'game');
      expect(gmLook(gm)).toMatchObject({ head: before.head, hair: before.hair, woman: before.woman });
    }
  });

  it('preserves a director’s silhouette and hair on promotion and during unemployment', () => {
    const l = world();
    const source = Object.values(l.staff).find((s) => s.teamId === 1 && s.role === 'director')!;
    source.woman = true;
    const original = lookOf(l, source);
    endGmAppointment(l, l.teams[1].gmId!, 'dismissed');
    const gm = appointDirectorAsGm(l, 1, source.id, { through: l.season, interim: true });
    const promoted = gmLook(gm);
    expect(promoted).toMatchObject({ head: original.head, hair: original.hair, woman: true });
    endGmAppointment(l, gm.id, 'dismissed');
    expect(gmLook(gm)).toEqual(promoted);
    expect(gmLook(JSON.parse(JSON.stringify(gm)))).toEqual(promoted);
  });

  it('renders a decorative SVG with unique IDs at both directory and card sizes', () => {
    const l = world();
    const gm = l.gms[l.userGmId];
    const html = renderToStaticMarkup(
      <>
        <GmAvatar league={l} gm={gm} size={28} />
        <GmAvatar league={l} gm={gm} size={128} />
      </>,
    );
    expect(html.match(/<svg /g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(gmStyleNotes(l, gm)).toHaveLength(1);
  });
});
