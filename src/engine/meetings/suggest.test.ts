import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { moraleContext, YEAR } from '../morale';
import { STARTERS } from '../positions';
import { activeRoster } from '../roster';
import { tierOf, unitOf, weightOf } from '../standing';
import { TRADE_DEADLINE_WEEK } from '../trade/rules';
import type { League, Player, TradeRecord } from '../types';
import { choicesFor, dueMoment, suggestMeeting } from './suggest';

const base = createLeague({ seed: 'meetings-suggest' });
const TEAM = 0;

/** A calm league at a regular-season week: every man Settled, no jolts, no ties, nothing offered yet. */
function calm(week = 5): League {
  const l = structuredClone(base);
  l.phase = 'regular';
  l.week = week;
  l.moraleAt = l.season * YEAR + 8 + week;
  for (const p of Object.values(l.players)) {
    if (p.morale) p.morale = { level: 0.5 };
    delete p.ties;
  }
  return l;
}

const room = (l: League, unit: string) => activeRoster(l, TEAM).filter((p) => unitOf(p.position) === unit);
const tiered = (l: League, men: Player[]) => men.filter((p) => tierOf(l, p, weightOf(l, p, moraleContext(l))) !== null);

/** A room with at least one leader or voice and a man who isn't one. */
function roomWithVoice(l: League): { unit: string; men: Player[]; voice: Player } {
  for (const unit of ['WR', 'OL', 'DL', 'DB', 'LB', 'RB']) {
    const men = room(l, unit);
    const t = tiered(l, men);
    if (t.length && t.length < men.length) return { unit, men, voice: t[0] };
  }
  throw new Error('no room with a voice');
}

/** Split: half the room Good, half Poor; the voice set apart. */
function split(men: Player[], voiceLevel: number, voice: Player) {
  men.forEach((p, i) => (p.morale = { level: i % 2 ? 2 : -2 }));
  voice.morale = { level: voiceLevel };
}

describe('meetings: the moments', () => {
  it('camp in the preseason', () => {
    const l = calm();
    l.phase = 'preseason';
    expect(dueMoment(l, TEAM)).toBe('camp');
  });

  it('the final the week the club won its conference final', () => {
    const l = calm();
    l.phase = 'playoffs';
    l.week = 21;
    const g = {
      ...structuredClone(l.games[0]),
      id: 9999,
      week: 21,
      homeId: TEAM,
      awayId: 1,
      playoffRound: 'CONF' as const,
    };
    g.result = {
      ...structuredClone(l.games.find((x) => x.result)?.result ?? ({} as never)),
      homeScore: 24,
      awayScore: 10,
    };
    l.games.push(g);
    expect(dueMoment(l, TEAM)).toBe('final');
    expect(dueMoment(l, 1)).toBeNull();
  });

  it('the deadline only in the race, or for a club that sold on deadline day', () => {
    const l = calm(TRADE_DEADLINE_WEEK);
    expect(dueMoment(l, TEAM)).toBe('deadline');
    const after = calm(TRADE_DEADLINE_WEEK + 1);
    expect(dueMoment(after, TEAM)).toBeNull();
    const sold: TradeRecord = {
      season: after.season,
      phase: 'regular',
      week: TRADE_DEADLINE_WEEK + 1,
      sides: [
        { teamId: TEAM, players: [room(after, 'WR')[0].id], picks: [] },
        { teamId: 1, players: [], picks: [1] },
      ],
      kind: 'player' as TradeRecord['kind'],
    };
    after.market = { ...(after.market ?? ({} as NonNullable<League['market']>)), history: [sold] };
    expect(dueMoment(after, TEAM)).toBe('deadline');
  });

  it('a moment comes once a league year, offered or not', () => {
    const l = calm();
    l.phase = 'preseason';
    const ctx = moraleContext(l);
    expect(suggestMeeting(l, TEAM, ctx)?.moment).toBe('camp');
    l.moraleAt! += 1;
    expect(suggestMeeting(l, TEAM, ctx)).toBeNull();
  });
});

describe('meetings: the approaches offered', () => {
  it('a split room: straight always; a leader only when he reads Good or better', () => {
    const l = calm();
    const { unit, men, voice } = roomWithVoice(l);
    for (const t of tiered(l, men)) t.morale = { level: -2 };
    split(
      men.filter((p) => !tiered(l, men).includes(p)),
      -2,
      voice,
    );
    for (const t of tiered(l, men)) t.morale = { level: -2 };
    const s = suggestMeeting(l, TEAM, moraleContext(l))!;
    expect(s.scope).toBe(unit);
    expect(s.approaches).toContain('straight');
    expect(s.approaches).not.toContain('leader');
    voice.morale = { level: 2 };
    const c = choicesFor(l, TEAM, s.scope, 'trouble', s.topic, undefined, moraleContext(l));
    expect(c.approaches).toContain('leader');
    expect(c.leader).toBe(voice.id);
  });

  it('a call-out only when a stirring voice reading Poor or worse drives it', () => {
    const l = calm();
    const { men, voice } = roomWithVoice(l);
    split(men, -2, voice);
    voice.traits.controversy = 3;
    let s = suggestMeeting(l, TEAM, moraleContext(l))!;
    expect(s.approaches).not.toContain('callout');
    const l2 = calm();
    const r2 = roomWithVoice(l2);
    split(r2.men, -2, r2.voice);
    r2.voice.traits.controversy = 20;
    s = suggestMeeting(l2, TEAM, moraleContext(l2))!;
    expect(s.approaches).toContain('callout');
    expect(s.driver).toBe(r2.voice.id);
  });
});

describe('meetings: what can be put behind it', () => {
  it('words always; talks, snaps and a feud only when they fit; a move only before the deadline while losing', () => {
    const l = calm();
    const { unit, men, voice } = roomWithVoice(l);
    const c0 = choicesFor(l, TEAM, unit as never, 'trouble', 'none', undefined, moraleContext(l));
    expect(c0.backings).toEqual(['words']);

    // A man who noticed who got paid, upset, whose deal can be talked about.
    const clock = l.moraleAt!;
    const dealMan = men.find((p) => p.contract && p.contract.kind !== 'rookie' && p.id !== voice.id);
    const backup = men.find(
      (p) =>
        p !== dealMan && !(l.teams[TEAM].depthChart[p.position] ?? []).slice(0, STARTERS[p.position]).includes(p.id),
    )!;
    if (dealMan) {
      dealMan.contract!.years = dealMan.contract!.years.slice(-1);
      dealMan.morale = { level: -2, jolts: [{ kind: 'snubbed', size: -3, at: clock }] };
    }
    backup.morale = { level: -2, jolts: [{ kind: 'benched', size: -3, at: clock }] };
    const [a, b] = men.filter((p) => p !== backup && p !== dealMan);
    a.ties = [{ kind: 'feud', with: b.id, since: l.season }];
    const c1 = choicesFor(l, TEAM, unit as never, 'trouble', 'none', undefined, moraleContext(l));
    expect(dealMan).toBeDefined();
    expect(c1.backings).toContain('talks');
    expect(c1.backings).toContain('snaps');
    expect(c1.backings).toContain('feud');
    expect(c1.backings).not.toContain('move');
    expect(c1.named).toContain(backup.id);
    expect(c1.named).toEqual(expect.arrayContaining([a.id, b.id]));

    // Losing before the deadline: a move is possible; after it, not.
    const lost = (g: League['games'][number]) =>
      (g.result = {
        ...structuredClone(base.games[0].result ?? ({} as never)),
        homeScore: g.homeId === TEAM ? 3 : 30,
        awayScore: g.homeId === TEAM ? 30 : 3,
      } as never);
    for (const g of l.games
      .filter((g) => g.season === l.season && (g.homeId === TEAM || g.awayId === TEAM))
      .slice(0, 2))
      lost(g);
    expect(choicesFor(l, TEAM, unit as never, 'trouble', 'none', undefined, moraleContext(l)).backings).toContain(
      'move',
    );
    l.week = TRADE_DEADLINE_WEEK + 1;
    expect(choicesFor(l, TEAM, unit as never, 'trouble', 'none', undefined, moraleContext(l)).backings).not.toContain(
      'move',
    );
  });
});

describe('meetings: cooldowns', () => {
  const troubled = () => {
    const l = calm();
    const { men, voice } = roomWithVoice(l);
    split(men, -2, voice);
    return { l, unit: unitOf(voice.position) };
  };
  const met = (l: League, unit: string, ago: number) =>
    l.teams[TEAM].meetings!.log.push({
      clock: l.moraleAt! - ago,
      scope: unit as never,
      kind: 'trouble',
      approach: 'straight',
      backing: 'words',
      timing: 'monday',
      outcomes: { lands: [], bristles: [] },
    });

  it('a room met with three weeks ago waits; four weeks ago it gets one', () => {
    const { l, unit } = troubled();
    met(l, unit, 3);
    expect(suggestMeeting(l, TEAM, moraleContext(l))).toBeNull();
    const t = troubled();
    met(t.l, t.unit, 4);
    expect(suggestMeeting(t.l, TEAM, moraleContext(t.l))?.scope).toBe(t.unit);
  });

  it('never two suggestions in one week', () => {
    const { l } = troubled();
    expect(suggestMeeting(l, TEAM, moraleContext(l))).not.toBeNull();
    expect(suggestMeeting(l, TEAM, moraleContext(l))).toBeNull();
  });
});
