import { beforeAll, describe, expect, it } from 'vitest';
import { seasonAwards } from './awards';
import { coachTitle, isCoachExpiring, teamCoaches } from './coaching';
import { logTransaction, releasePlayer } from './finance/cap';
import { createLeague, generatePlayer } from './generate';
import { applyInjury, IR_MIN_WEEKS, manageInjuries, NEED, placeOnIr } from './injuries';
import { signPlayer } from './offseason/negotiation';
import { Rng } from './rng';
import { migrateLeague } from './migrate';
import {
  aPosition,
  archiveMail,
  archiveRead,
  briefingCurrent,
  deadlineDayTrades,
  deleteMail,
  deliverMail,
  draftClassOf,
  freeAgencyMoves,
  gameStory,
  headCoachChanges,
  EDGE_GAP,
  keyMatchups,
  mailForOffer,
  mailSubject,
  marketRumors,
  marketTrades,
  markAllRead,
  memberTitle,
  needsYou,
  offerMailId,
  offerWords,
  reasonLine,
  statBlurb,
  threadLabel,
  threads,
  unitReads,
  unreadCount,
  marketMail,
  snnRan,
  tradeAngle,
  tradeRecordFor,
} from './inbox';
import { emptyMarket } from './trade/execute';
import { tradeIdentity } from './tradeNews';
import { isMedicExpiring, teamMedics } from './medical';
import { playWeek, simToEndOfRegularSeason, simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
import { expiringPlayers } from './offseason/ai';
import { activeRoster, teamPlayers } from './roster';
import { computeRecords, conferenceSeeds } from './season/standings';
import { isExpiring, teamStaff } from './staff';
import { playerOvr } from './positions';
import { answerEnquiry, counterOffer, openOffers, TRADE_DEADLINE_WEEK } from './trade';
import type { TradeProposal } from './trade/rules';
import { changePosition, passMove, setCoachesDecide, startMove, suggestMove } from './training';
import type {
  Game,
  GameResult,
  League,
  MoveReason,
  Player,
  Position,
  Ratings,
  TeamGameStats,
  TradeOffer,
} from './types';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('inbox', () => {
  const league = createLeague({ seed: 'inbox' });

  it('files one opposition report a week, however often it is delivered', () => {
    deliverMail(league);
    deliverMail(league);
    // A new game opens with the owner's welcome and the head coach's rundown, then the week's report.
    expect(league.inbox!.map((m) => m.id)).toEqual([
      `owner:${league.season}:welcome:${league.userTeamId}:0`,
      `rundown:${league.season}:${league.userTeamId}:0`,
      `matchup:${league.season}:1`,
    ]);
    expect(unreadCount(league)).toBe(3);
  });

  it('keeps the report current without making it a management task', () => {
    const report = league.inbox!.find((m) => m.category === 'matchup')!;
    expect(mailSubject(report)).toEqual({ kind: 'matchup', season: league.season, week: 1 });
    expect(needsYou(league, report)).toBe(false);
    expect(briefingCurrent(league, report)).toBe(true);
    const played = copy(league);
    playWeek(played);
    expect(needsYou(played, report)).toBe(false);
    expect(briefingCurrent(played, report)).toBe(false);
  });

  it('tells the user about their own award winners and trades, once', () => {
    simToEndOfRegularSeason(league);
    // Make the MVP's team the user's, so there is an award to announce.
    const mvp = seasonAwards(league, league.season)!.winners.mvp!;
    league.userTeamId = mvp.teamId!;
    league.userGmId = league.teams[league.userTeamId].gmId!;
    logTransaction(
      league,
      'trade',
      [league.userTeamId, (league.userTeamId + 1) % 32],
      'AAA traded QB A to BBB for QB B',
    );
    deliverMail(league);
    const before = league.inbox!.length;
    deliverMail(league);
    expect(league.inbox!.length).toBe(before);
    const award = league.inbox!.find((m) => m.id === `awards:${league.season}:year:${mvp.playerId}`)!;
    expect(award.subject).toContain('Most Valuable Player');
    expect(award.actions).toEqual([{ kind: 'player', playerId: mvp.playerId }]);
    // Once for the trade above (as an AI team, the MVP's may have traded in season too).
    expect(
      league.inbox!.filter((m) => m.id.startsWith('trades:') && m.id.endsWith(':AAA traded QB A to BBB for QB B')),
    ).toHaveLength(1);
    // Every award message is about the user's team.
    for (const m of league.inbox!.filter((x) => x.category === 'awards')) expect(m.actions[0].kind).toBe('player');
    // One year-end message per player, however many season honors he won.
    const yearEnd = league.inbox!.filter((m) => m.id.startsWith(`awards:${league.season}:year:`)).map((m) => m.id);
    expect(new Set(yearEnd).size).toBe(yearEnd.length);
  });

  it("passes on the doctor's word about our injured players, with his estimate", () => {
    const hurt = league.inbox!.filter((m) => m.category === 'medical');
    const out = teamPlayers(league, league.userTeamId).filter((p) => p.injury && p.injury.estimate[1] >= 1);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out)
      expect(hurt.some((m) => m.actions.some((a) => a.kind === 'player' && a.playerId === p.id))).toBe(true);
    for (const m of hurt) expect(m.actions.map((a) => a.kind)).toEqual(['player', 'medical']);
  });

  it('says "are" for the units that are plural', () => {
    for (const m of league.inbox!.filter((x) => x.category === 'matchup')) expect(m.body).not.toMatch(/linebackers is/);
  });

  it('reads back what every message is about', () => {
    const kinds: Record<string, string[]> = {
      matchup: ['matchup', 'recap'],
      medical: ['injury', 'cleared'],
      awards: ['award'],
      trades: ['trade', 'deadline', 'market', 'marketRecap'],
      league: ['race', 'news', 'leadership'],
      staff: ['leadership', 'gmOffer', 'owner', 'rundown'],
    };
    for (const m of league.inbox!) {
      const s = mailSubject(m)!;
      expect(kinds[m.category]).toContain(s.kind);
      expect(s.season).toBe(m.season);
      if (s.kind === 'award') expect(m.actions).toContainEqual({ kind: 'player', playerId: s.playerId });
    }
    const trade = league.inbox!.find(
      (m) => m.id.startsWith('trades:') && m.id.endsWith(':AAA traded QB A to BBB for QB B'),
    )!;
    expect(mailSubject(trade)).toMatchObject({ kind: 'trade', text: 'AAA traded QB A to BBB for QB B' });
  });

  it("opens the league year with the owner's letter and our staff deals", () => {
    simToEndOfSeason(league);
    beginOffseason(league);
    deliverMail(league);
    const owner = league.inbox!.find((m) => m.id === `owner:${league.season}:${league.userTeamId}`)!;
    expect(owner.category).toBe('staff');
    expect(owner.body).toContain(`budgets for ${league.season}`);
    expect(mailSubject(owner)).toEqual({ kind: 'owner', season: league.season });
    const user = league.userTeamId;
    const people = [
      ...teamCoaches(league, user)
        .filter((c) => isCoachExpiring(league, c))
        .map((c) => ({ kind: 'coach', id: c.id })),
      ...teamStaff(league, user)
        .filter((x) => isExpiring(league, x))
        .map((x) => ({ kind: 'scout', id: x.id })),
      ...teamMedics(league, user)
        .filter((m) => isMedicExpiring(league, m))
        .map((m) => ({ kind: 'medic', id: m.id })),
    ];
    const deals = league.inbox!.filter((m) => m.id.startsWith(`staff:${league.season}:deals`));
    expect(deals).toHaveLength(people.length ? 1 : 0);
    for (const m of deals) {
      expect(mailSubject(m)).toEqual({ kind: 'staffDeals', season: league.season, people });
      expect(needsYou(league, m)).toBe(true);
    }
    deliverMail(league);
    expect(
      league.inbox!.filter(
        (m) => m.season === league.season && (m.id.startsWith('owner:') || m.id.startsWith('staff:')),
      ),
    ).toHaveLength(1 + deals.length);
  });

  it("folds a day of agents' letters into one, and leaves other mail as it is", () => {
    const all = [...league.inbox!].reverse();
    const letters = all.filter((m) => m.id.startsWith(`contracts:${league.season}:`));
    const list = threads(all);
    const folded = list.find((t) => t.kind === 'contract')!;
    expect(folded.messages).toEqual(letters);
    if (letters.length > 1) expect(threadLabel(folded).subject).toBe(`${letters.length} contracts are up`);
    // Every message is in exactly one thread, and kinds that don't fold stand alone.
    expect(list.flatMap((t) => t.messages)).toHaveLength(all.length);
    for (const t of list)
      if (t.kind === 'owner' || t.kind === 'matchup' || t.kind === 'recap') expect(t.messages).toHaveLength(1);
  });

  it('archives and deletes, with an undo, and never files a deleted message again', () => {
    const l = copy(league);
    const [first, second] = l.inbox!.filter((m) => m.id.startsWith(`contracts:${l.season}:`));
    archiveMail(l, [first.id]);
    expect(l.inbox!.find((m) => m.id === first.id)).toMatchObject({ archived: true, read: true });
    // Archived mail is out of the inbox's unread count.
    archiveMail(
      l,
      l.inbox!.map((m) => m.id),
    );
    expect(unreadCount(l)).toBe(0);
    archiveMail(
      l,
      l.inbox!.map((m) => m.id).filter((id) => id !== first.id),
      false,
    );
    archiveMail(l, [first.id], false);
    expect(l.inbox!.find((m) => m.id === first.id)!.archived).toBeUndefined();
    deleteMail(l, [second.id]);
    const before = l.inbox!.length;
    deliverMail(l);
    expect(l.inbox!.length).toBe(before);
    expect(l.inbox!.find((m) => m.id === second.id)!.deleted).toBe(true);
    // Archive read files away only what's read and no longer asks anything.
    markAllRead(l);
    archiveRead(l);
    for (const m of l.inbox!) if (!m.deleted) expect(!!m.archived).toBe(!needsYou(l, m));
  });

  it('admits new same-date mail after rollover without resurrecting deleted mail, including after reload', () => {
    const l = createLeague({ seed: 'same-day-mail' });
    const log = (n: number) => logTransaction(l, 'trade', [l.userTeamId, (l.userTeamId + 1) % 32], `Deal ${n}`);
    for (let i = 0; i < 301; i++) log(i);
    deliverMail(l);
    const first = l.inbox!.find((m) => m.id.endsWith(':Deal 300'))!;
    expect(first).toBeDefined();
    deleteMail(l, [first.id]);
    log(301);
    deliverMail(l);
    expect(l.inbox!.some((m) => m.id.endsWith(':Deal 301'))).toBe(true);
    expect(l.inbox!.some((m) => m.id.endsWith(':Deal 0'))).toBe(false);
    const loaded = copy(l);
    deliverMail(loaded);
    expect(loaded.inbox).toEqual(l.inbox);
    expect(loaded.inbox!.find((m) => m.id === first.id)?.deleted).toBe(true);
    expect(loaded.inbox).toHaveLength(300);
  });

  it('advances the eviction boundary without keeping tombstones for every historical date', () => {
    const l = createLeague({ seed: 'mail-boundary' });
    const logBatch = (week: number) => {
      l.week = week;
      for (let i = 0; i < 301; i++)
        logTransaction(l, 'trade', [l.userTeamId, (l.userTeamId + 1) % 32], `Week ${week} deal ${i}`);
      deliverMail(l);
    };
    logBatch(1);
    logBatch(2);
    expect(l.mailFloor!.ids.length).toBeLessThan(10);
    expect(l.mailFloor!.ids.every((id) => !id.includes('Week 1 deal'))).toBe(true);
    const again = copy(l);
    deliverMail(again);
    expect(again.inbox).toEqual(l.inbox);
    expect(again.inbox!.some((m) => m.id.includes('Week 1 deal'))).toBe(false);
  });

  it('never files mail again once a full inbox has let it go', () => {
    const l = copy(league);
    const user = l.userTeamId;
    logTransaction(l, 'trade', [user, (user + 1) % 32], 'AAA traded QB A to BBB for QB B');
    Object.assign(l.transactions[l.transactions.length - 1], { season: l.season - 1, phase: 'regular', week: 3 });
    l.inbox = [];
    deliverMail(l);
    const old = l.inbox.find((m) => m.id.endsWith(':AAA traded QB A to BBB for QB B'))!;
    deleteMail(l, [old.id]);
    // Fill the inbox with later mail, the old trade at the front, then a new deal pushes it off.
    const filler = (i: number) => ({
      ...old,
      id: `filler:${i}`,
      phase: 'complete' as const,
      week: 0,
      deleted: undefined,
    });
    l.inbox = [old, ...Array.from({ length: 299 }, (_, i) => filler(i))];
    logTransaction(l, 'trade', [user, (user + 1) % 32], 'AAA traded QB C to BBB for QB D');
    deliverMail(l);
    expect(l.inbox).toHaveLength(300);
    expect(l.inbox.some((m) => m.id === old.id)).toBe(false);
    expect(l.inbox.some((m) => m.id.endsWith(':AAA traded QB C to BBB for QB D'))).toBe(true);
    deliverMail(l);
    expect(l.inbox.some((m) => m.id === old.id)).toBe(false);
  });

  it('opens the league year with expiring deals and retirements, and the combine with free agency', () => {
    const year = league.inbox!.filter((m) => m.season === league.season && m.phase === 'resign');
    const deals = year.filter((m) => m.category === 'contracts');
    expect(deals).toHaveLength(expiringPlayers(league, league.userTeamId).length);
    for (const m of deals) expect(needsYou(league, m)).toBe(true);
    const retired = Object.values(league.players).filter(
      (p) => p.retired && p.statTeams?.[league.season - 1]?.at(-1) === league.userTeamId,
    );
    expect(year.filter((m) => m.category === 'retirement')).toHaveLength(retired.length);
    // The NFL's combine wraps up just before free agency opens: not yet.
    expect(league.inbox!.some((m) => m.id === `scouting:${league.season}:combine`)).toBe(false);
    do {
      advanceOffseason(league);
    } while (league.phase === 'resign');
    deliverMail(league);
    const combine = league.inbox!.find((m) => m.id === `scouting:${league.season}:combine`)!;
    expect(combine.phase).toBe('freeAgency');
    expect(needsYou(league, combine)).toBe(league.scoutPoints > 0);
    // Free agency closes the re-sign window: the agents' letters no longer ask anything.
    for (const m of deals) expect(needsYou(league, m)).toBe(false);
  });

  it('reports the coaching carousel, and a coach hired away until his chair is filled', () => {
    const changes = headCoachChanges(league);
    expect(league.inbox!.some((m) => m.id === `league:${league.season}:carousel`)).toBe(changes.length > 0);
    for (const x of changes) {
      expect(x.coach.role).toBe('headCoach');
      expect(x.coach.teamId).toBe(x.teamId);
      expect(x.replaced).not.toBe(x.coach);
    }
    // Staged: another team promotes our coordinator to head coach (copies rebuild the coach index).
    const staged = copy(league);
    const user = staged.userTeamId;
    const coordinator = Object.values(staged.coaches).find(
      (c) => c.teamId === user && (c.role === 'offCoord' || c.role === 'defCoord'),
    )!;
    const chair = { role: coordinator.role };
    const was = coachTitle(coordinator).toLowerCase();
    const hirer = staged.teams.find((t) => t.id !== user)!;
    for (const c of Object.values(staged.coaches)) if (c.teamId === hirer.id && c.role === 'headCoach') c.teamId = null;
    Object.assign(coordinator, { teamId: hirer.id, role: 'headCoach' });
    logTransaction(
      staged,
      'coach',
      [hirer.id, user],
      `${hirer.abbrev} hired ${staged.teams[user].abbrev} ${was} ${coordinator.firstName} ${coordinator.lastName} as head coach`,
    );
    const world = copy(staged);
    deliverMail(world);
    const gone = world.inbox!.find((m) => m.id.startsWith(`staff:${world.season}:gone:${coordinator.id}:`))!;
    expect(mailSubject(gone)).toEqual({ kind: 'poached', season: world.season, coachId: coordinator.id, chair });
    expect(gone.body).toContain(`our ${was}, as their head coach`);
    expect(gone.body).toContain('promote from within');
    expect(needsYou(world, gone)).toBe(true);
    // A new man in the chair answers it.
    Object.values(world.coaches).find((c) => c.teamId === null && c.role === chair.role)!.teamId = user;
    expect(needsYou(copy(world), gone)).toBe(false);
    // A head coach who sat last season out: his last chair is two seasons back, not "new to the league".
    const rested = copy(league);
    const hc = Object.values(rested.coaches).find(
      (c) =>
        c.teamId !== null &&
        c.role === 'headCoach' &&
        c.career?.some((x) => x.season === rested.season - 1 && x.teamId === c.teamId),
    )!;
    const elsewhere = (hc.teamId! + 1) % rested.teams.length;
    hc.career = [{ season: rested.season - 2, teamId: elsewhere, role: 'headCoach' }];
    const change = headCoachChanges(copy(rested)).find((x) => x.coach.id === hc.id)!;
    expect(change.from).toMatchObject({ season: rested.season - 2, teamId: elsewhere, title: 'Head coach' });
  });

  it('reports our draft class once the draft is done', () => {
    while (league.phase === 'freeAgency') advanceOffseason(league);
    deliverMail(league);
    const day = league.inbox!.find((m) => m.id === `scouting:${league.season}:draft`)!;
    expect(needsYou(league, day)).toBe(true);
    expect(league.inbox!.some((m) => m.id === `scouting:${league.season}:class`)).toBe(false);
    do {
      advanceOffseason(league);
    } while (league.phase === 'resign');
    deliverMail(league);
    expect(needsYou(league, day)).toBe(false);
    const picks = draftClassOf(league, league.season);
    expect(picks.length).toBeGreaterThan(0);
    const report = league.inbox!.find((m) => m.id === `scouting:${league.season}:class`)!;
    expect(report.body).toContain(`We made ${picks.length} pick`);
    // The class in a few words: our first pick against the consensus, and the one our scouts like most, in the report's own verdict.
    expect(report.body).toMatch(
      /at No\. \d+( \((the consensus had him at No\. \d+|right where the consensus had him)\))?\./,
    );
    expect(report.body).toMatch(/ Our scouts like [A-Z]+ .+ most of all: an? .+\.$/);
    expect(report.body).not.toMatch(/undefined|NaN/);
    expect(mailSubject(report)).toEqual({ kind: 'draftClass', season: league.season });
  });

  it('sums up free agency once it closes, with our signings and the players who left', () => {
    const wrap = league.inbox!.find((m) => m.id === `fa:${league.season}`)!;
    expect(wrap.phase).toBe('draft');
    expect(wrap.body).toMatch(/^Free agency is over\. /);
    expect(mailSubject(wrap)).toEqual({ kind: 'faWrap', season: league.season });
    const fa = freeAgencyMoves(league);
    for (const d of fa.signed) expect(d.teamId).toBe(league.userTeamId);
    for (const d of fa.walked) {
      expect(d.teamId).not.toBe(league.userTeamId);
      expect(d.player.statTeams?.[league.season - 1]?.at(-1)).toBe(league.userTeamId);
    }
    expect(fa.biggest.length).toBeGreaterThan(0);
    // The deals that shaped it, when there were any: ours, the loss that hurts, the league's richest.
    if (fa.signed.length)
      expect(wrap.body).toContain(
        `Our biggest deal was ${fa.signed[0].player.position} ${fa.signed[0].player.firstName} ${fa.signed[0].player.lastName}`,
      );
    if (fa.walked.length)
      expect(wrap.body).toContain(
        `The one that hurts is ${fa.walked[0].player.position} ${fa.walked[0].player.firstName} ${fa.walked[0].player.lastName}, gone to the`,
      );
    if (fa.biggest[0].teamId !== league.userTeamId && fa.biggest[0].player.id !== fa.walked[0]?.player.id)
      expect(wrap.body).toContain('Around the league, the richest deal was');
    // Never the same deal twice: the loss that hurts is not also "the richest around the league".
    if (fa.walked.length)
      expect(wrap.body.split(`${fa.walked[0].player.firstName} ${fa.walked[0].player.lastName}`).length).toBe(2);
    // (The coaches' position suggestion is staff mail that may still ask, through the draft and camp.)
    for (const m of league.inbox!)
      expect(needsYou(league, m) && m.category === 'staff' && mailSubject(m)?.kind !== 'positionOffer').toBe(false);
  });

  it('marks everything read in one go', () => {
    const all = copy(league);
    markAllRead(all);
    expect(unreadCount(all)).toBe(0);
  });

  it('keeps read state through save and load', () => {
    league.inbox![0].read = true;
    const loaded = copy(league);
    deliverMail(loaded);
    expect(loaded.inbox).toEqual(league.inbox);
    expect(unreadCount(loaded)).toBe(unreadCount(league));
  });

  it('files an older save’s history as already read', () => {
    const old = copy(league);
    delete old.inbox;
    deliverMail(old);
    expect(old.inbox!.length).toBeGreaterThan(0);
    expect(unreadCount(old)).toBe(0);
  });
});

describe('mail through a season', () => {
  const league = createLeague({ seed: 'inbox-season' });
  const user = league.userTeamId;
  const needsAt = new Map<string, boolean[]>();

  it('files a recap after each of our games, naming the player of the game', () => {
    deliverMail(league);
    while (league.phase === 'regular' || league.phase === 'playoffs') {
      playWeek(league);
      deliverMail(league);
      for (const m of league.inbox!)
        if (m.id.startsWith('deadline:')) needsAt.set(m.id, [...(needsAt.get(m.id) ?? []), briefingCurrent(league, m)]);
    }
    const ours = league.games.filter(
      (g) => g.season === league.season && g.result && (g.homeId === user || g.awayId === user),
    );
    const recaps = league.inbox!.filter((m) => m.id.startsWith('recap:'));
    expect(recaps).toHaveLength(ours.length);
    for (const m of recaps) {
      const s = mailSubject(m)!;
      expect(s.kind).toBe('recap');
      expect(m.body).toMatch(/^We (beat|lost to|tied) the /);
      expect(m.body).toContain('was the player of the game');
      expect(m.actions).toEqual([{ kind: 'game', gameId: s.kind === 'recap' ? s.gameId : -1 }]);
      expect(needsYou(league, m)).toBe(false);
      // The result, one sentence on what decided it, the player of the game: never a wall of text.
      expect(m.body.split(/\. (?=[A-Z])/).length).toBeLessThanOrEqual(3);
      expect(m.body).not.toMatch(/undefined|NaN/);
    }
    // Every recap's story is read off its own box score, from our side.
    for (const g of ours) {
      const m = recaps.find((x) => x.id === `recap:${g.season}:${g.id}`)!;
      const { swing, takeaway } = gameStory(g.result!, g.homeId === user);
      expect(m.body).toContain(takeaway);
      if (swing) expect(m.body).toContain(swing);
    }
    // The opposition reports say where they look soft and what it opens up, with the confidence the read allows.
    const reports = league.inbox!.filter((m) => m.id.startsWith('matchup:'));
    expect(reports.length).toBeGreaterThan(10);
    for (const m of reports) {
      expect(m.body).toMatch(/^We (host|visit|meet) the .* in (week \d+|the )/);
      expect(m.body).toMatch(/(the soft spot and their .* (is|are) the threat|No unit stands out)/);
      // Short: the opener and the read, two or three sentences.
      expect(m.body.split('\n\n')[0].split(/(?<=\.) /).length).toBeLessThanOrEqual(3);
      expect(m.body).not.toMatch(/we'll go after them|linebackers is/);
    }
  });

  it('reminds us of the trade deadline the week before, the week of and on deadline day, until it passes', () => {
    const before = league.inbox!.find((m) => m.id === `deadline:${league.season}:1`)!;
    const now = league.inbox!.find((m) => m.id === `deadline:${league.season}:0`)!;
    const day = league.inbox!.find((m) => m.id === `deadline:${league.season}:day`)!;
    expect(before.week).toBe(TRADE_DEADLINE_WEEK - 1);
    expect(now.week).toBe(TRADE_DEADLINE_WEEK);
    // Deadline day is the day after the deadline week: trades are still open.
    expect(day.week).toBe(TRADE_DEADLINE_WEEK + 1);
    expect(mailSubject(day)).toEqual({ kind: 'deadline', season: league.season, weeksLeft: 'day' });
    expect(day.body).toContain(`Once week ${TRADE_DEADLINE_WEEK + 1} is played`);
    // Each briefing stays current until deadline day has gone by: the week-of reminder still does on deadline day.
    for (const m of [now, day]) {
      expect(needsAt.get(m.id)![0]).toBe(true);
      expect(needsAt.get(m.id)!.at(-1)).toBe(false);
    }
    expect(needsAt.get(now.id)!.filter(Boolean)).toHaveLength(2);
  });

  it("sends the director's market report weekly up to the deadline, then a recap once it has passed", () => {
    const reports = league.inbox!.filter((m) => m.id.startsWith(`market:${league.season}:regular:`));
    expect(reports.length).toBeGreaterThan(0);
    for (const m of reports) {
      const s = mailSubject(m)!;
      if (s.kind !== 'market') throw new Error(m.id);
      expect(s.week).toBeGreaterThanOrEqual(5);
      expect(s.week).toBeLessThanOrEqual(TRADE_DEADLINE_WEEK);
      // It reports what the market did the week before, never our own trades.
      const trades = marketTrades(league, s.season, s.phase, s.week);
      expect(trades.length + marketRumors(league, s.season, s.phase, s.week).length).toBeGreaterThan(0);
      for (const t of trades) expect(t.teamIds).not.toContain(user);
      expect(m.from).toContain('Director of scouting');
    }
    const recap = league.inbox!.find((m) => m.id === `market:${league.season}:recap`)!;
    expect(recap.week).toBeGreaterThan(TRADE_DEADLINE_WEEK + 1);
    expect(mailSubject(recap)).toEqual({ kind: 'marketRecap', season: league.season });
    const all = league.transactions.filter(
      (t) => t.kind === 'trade' && t.season === league.season && t.phase === 'regular',
    ).length;
    expect(recap.body).toContain(`went through this season`);
    expect(recap.body.toLowerCase()).toContain(
      all < 10 ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][all] : String(all),
    );
    expect(deadlineDayTrades(league).length).toBeLessThanOrEqual(all);
  });

  it('clears a player we wrote about once he is healthy, and only him', () => {
    const cleared = league.inbox!.filter((m) => m.id.startsWith('cleared:'));
    expect(cleared.length).toBeGreaterThan(0);
    for (const m of cleared)
      expect(league.inbox!.some((x) => x.id === m.id.replace('cleared:', 'medical:'))).toBe(true);
  });

  it('calls our playoff fate the way the final standings bear out, once per level', () => {
    const seed = conferenceSeeds(league, league.teams[user].conference, computeRecords(league)).indexOf(user);
    const race = league.inbox!.filter((m) => m.category === 'league' && m.id.startsWith('race:'));
    expect(race.length).toBeGreaterThan(0);
    expect(new Set(race.map((m) => m.id)).size).toBe(race.length);
    for (const m of race) {
      const s = mailSubject(m)!;
      if (s.kind !== 'race') throw new Error(m.id);
      if (s.level === 'out') expect(seed).toBe(-1);
      else expect(seed).toBeGreaterThanOrEqual(0);
      if (s.level === 'division') expect(seed).toBeLessThan(4);
      if (s.level === 'bye') expect(seed).toBe(0);
    }
  });
});

describe('position moves in the inbox', () => {
  // A league in the draft, with the user on a team whose coaches have a move to suggest.
  const base = createLeague({ seed: 'inbox' });
  let playerId = -1;
  let to: Position = 'S';
  let read: NonNullable<ReturnType<typeof suggestMove>>['read'];
  let why: MoveReason = 'hole';
  const offersIn = (l: League) => l.inbox!.filter((m) => m.id.startsWith(`position:${l.season}:offer:`));
  const movedIn = (l: League) => l.inbox!.filter((m) => m.id.startsWith(`position:${l.season}:moved:`));
  const nameOf = (l: League) => `${l.players[playerId].firstName} ${l.players[playerId].lastName}`;
  /** Start the suggested plan, call him ready and run the calendar to cut-down day. */
  const throughCutDown = (l: League) => {
    startMove(l, playerId, to, why);
    l.players[playerId].learning!.done = 100;
    while (l.phase !== 'regular') advanceOffseason(l);
  };

  beforeAll(() => {
    simToEndOfSeason(base);
    beginOffseason(base);
    while (base.phase !== 'draft') advanceOffseason(base);
    const team = base.teams.find((t) => suggestMove(base, t.id))!;
    base.userTeamId = team.id;
    base.userGmId = team.gmId!;
    base.inbox = [];
    const pick = suggestMove(base, team.id)!;
    playerId = pick.player.id;
    to = pick.read.to;
    read = pick.read;
    why = pick.why;
  });

  it("files the coaches' suggestion once a league year, in the head coach's words", () => {
    const l = copy(base);
    deliverMail(l);
    deliverMail(l);
    const [offer, ...more] = offersIn(l);
    expect(more).toHaveLength(0);
    expect(offer.id).toBe(`position:${l.season}:offer:${playerId}:${to}`);
    expect(offer.category).toBe('staff');
    expect(offer.from).toContain('Head coach');
    expect(offer.actions).toEqual([{ kind: 'player', playerId }, { kind: 'coaches' }]);
    expect(mailSubject(offer)).toEqual({ kind: 'positionOffer', season: l.season, playerId, to });
    expect(needsYou(l, offer)).toBe(true);
    const p = l.players[playerId];
    for (const part of [
      nameOf(l),
      `${p.age}-year-old`,
      reasonLine(why, to, read.coordinator),
      'cut-down day',
      'before the draft closes',
      'Not now',
      String(l.season + 2),
    ])
      expect(offer.body).toContain(part);
    // Camp is the last chance to start it, and it is still the one suggestion that year.
    advanceOffseason(l);
    deliverMail(l);
    expect(l.phase).toBe('preseason');
    expect(offersIn(l)).toHaveLength(1);
    expect(needsYou(l, offer)).toBe(true);
  });

  it('says nothing when the coaches decide for themselves, or once the regular season is on', () => {
    const decided = copy(base);
    setCoachesDecide(decided, true);
    deliverMail(decided);
    expect(decided.inbox!.filter((m) => m.id.startsWith('position:'))).toHaveLength(0);
    const late = copy(base);
    late.phase = 'regular';
    late.week = 1;
    deliverMail(late);
    expect(late.inbox!.filter((m) => m.id.startsWith('position:'))).toHaveLength(0);
  });

  it('asks until you start it, turn it down, or camp is over', () => {
    const l = copy(base);
    deliverMail(l);
    const offer = offersIn(l)[0];
    expect(needsYou(l, offer)).toBe(true);
    const started = copy(l);
    startMove(started, playerId, to, why);
    expect(needsYou(started, offer)).toBe(false);
    const passed = copy(l);
    passMove(passed, playerId);
    expect(needsYou(passed, offer)).toBe(false);
    // Turning it down is final for the year: delivering again does not raise another.
    deliverMail(passed);
    expect(offersIn(passed)).toHaveLength(1);
    const regular = copy(l);
    regular.phase = 'regular';
    expect(needsYou(regular, offer)).toBe(false);
    const gone = copy(l);
    gone.players[playerId].teamId = null;
    expect(needsYou(gone, offer)).toBe(false);
    // The offer is for this league year only.
    const next = copy(l);
    next.season++;
    expect(needsYou(next, offer)).toBe(false);
  });

  it('files a note once, when cut-down day makes the move', () => {
    const l = copy(base);
    const team = l.teams[l.userTeamId];
    team.autoDepth = true;
    deliverMail(l);
    throughCutDown(l);
    expect(l.players[playerId].position).toBe(to);
    deliverMail(l);
    deliverMail(l);
    const [note, ...more] = movedIn(l);
    expect(more).toHaveLength(0);
    expect(note.id).toBe(`position:${l.season}:moved:${playerId}`);
    expect(note.category).toBe('staff');
    expect(note.subject).toBe(`${nameOf(l)} is now ${aPosition(to)}`);
    expect(note.phase).toBe('preseason');
    expect(note.actions).toEqual([
      { kind: 'player', playerId },
      { kind: 'team', teamId: team.id },
    ]);
    expect(mailSubject(note)).toEqual({ kind: 'positionMoved', season: l.season, playerId });
    expect(needsYou(l, note)).toBe(false);
    for (const part of [nameOf(l), 'on cut-down day', "can't be traded until the new league year"])
      expect(note.body).toContain(part);
    // The reason he was moved for, read from the news line ("their scheme wants him…").
    expect(note.body).toContain(reasonLine(why, to));
    expect(note.body).not.toContain('placed by rating');
    // The suggestion is answered by now, and a deleted note is not filed again.
    expect(needsYou(l, offersIn(l)[0])).toBe(false);
    deleteMail(l, [note.id]);
    deliverMail(l);
    expect(movedIn(l)).toHaveLength(1);
    expect(movedIn(l)[0].deleted).toBe(true);
  });

  it('says where he was placed when the depth chart is hand-sorted', () => {
    const l = copy(base);
    l.teams[l.userTeamId].autoDepth = false;
    throughCutDown(l);
    deliverMail(l);
    expect(movedIn(l)[0].body).toContain(`He is placed by rating on your ${to} depth chart.`);
  });

  it('files no note for a player who came to us already moved by another team', () => {
    const l = copy(base);
    while (l.phase !== 'regular') advanceOffseason(l);
    // Another team moves its corner on its cut-down day, and he joins us after it.
    const ai = l.teams.find((t) => t.id !== l.userTeamId)!;
    const cb = teamPlayers(l, ai.id).find((p) => p.position === 'CB')!;
    changePosition(l, cb, 'S');
    cb.teamId = l.userTeamId;
    deliverMail(l);
    expect(cb.moves?.at(-1)?.season).toBe(l.season);
    expect(movedIn(l).map((m) => m.id)).not.toContain(`position:${l.season}:moved:${cb.id}`);
  });

  it("folds a cut-down day's notes into one thread", () => {
    const l = copy(base);
    throughCutDown(l);
    deliverMail(l);
    const [note] = movedIn(l);
    const twin = { ...note, id: note.id.replace(`:moved:${playerId}`, ':moved:999999') };
    const list = threads([twin, note]);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('positionMoved');
    expect(threadLabel(list[0]).subject).toBe('2 players change position');
    expect(memberTitle(note)).toBe(nameOf(l));
    expect(threads([note])[0].messages).toHaveLength(1);
  });
});

describe('the story of a game', () => {
  const stats = (over: Partial<TeamGameStats> = {}): TeamGameStats => ({
    firstDowns: 20,
    plays: 60,
    totalYds: 340,
    passYds: 240,
    rushYds: 100,
    passAtt: 32,
    passCmp: 20,
    rushAtt: 25,
    sacked: 2,
    turnovers: 1,
    penalties: 5,
    penaltyYds: 40,
    thirdDownAtt: 12,
    thirdDownConv: 5,
    fourthDownAtt: 0,
    fourthDownConv: 0,
    redZoneAtt: 3,
    redZoneTd: 2,
    top: 30 * 60,
    ...over,
  });
  /** A box score from the home side: quarter scores for us and them, and whatever stats matter to the story. */
  const game = (
    us: number[],
    them: number[],
    ours: Partial<TeamGameStats> = {},
    theirs: Partial<TeamGameStats> = {},
    overtime = false,
  ): GameResult => ({
    homeScore: us.reduce((a, b) => a + b, 0),
    awayScore: them.reduce((a, b) => a + b, 0),
    overtime,
    quarters: { home: us, away: them },
    home: stats(ours),
    away: stats(theirs),
    playerStats: {},
    playerTeams: {},
  });

  it('tells a comeback, a lead let go, and the turnover battle from the quarters and the stats', () => {
    // Trailed 17–10 at the half, won 24–20 on two takeaways while being outgained.
    expect(
      gameStory(
        game([3, 7, 7, 7], [7, 10, 3, 0], { totalYds: 318, turnovers: 0 }, { totalYds: 362, turnovers: 2 }),
        true,
      ),
    ).toEqual({
      swing: ' after trailing by seven at halftime',
      takeaway: 'We outscored them 14–3 after the break, and two takeaways helped turn it around.',
    });
    // The same game from the road team's side: a lead let go, without a turnover story (one giveaway apart is noise).
    expect(gameStory(game([3, 7, 7, 7], [7, 10, 3, 0], { turnovers: 0 }, { turnovers: 1 }), false)).toEqual({
      swing: ' after leading by seven at halftime',
      takeaway: 'They outscored us 14–3 after the break.',
    });
    // More yards, more turnovers, a three-point loss.
    expect(
      gameStory(
        game([7, 3, 7, 0], [7, 7, 3, 3], { totalYds: 410, turnovers: 3 }, { totalYds: 280, turnovers: 0 }),
        true,
      ),
    ).toEqual({
      swing: '',
      takeaway:
        'We moved the ball better than they did, but three turnovers cost us possessions and left too little room for error.',
    });
    expect(
      gameStory(
        game([7, 3, 7, 0], [7, 7, 3, 3], { totalYds: 300, turnovers: 3 }, { totalYds: 280, turnovers: 0 }),
        true,
      ).takeaway,
    ).toBe('We lost the turnover battle 3–0, and that is where the game went.');
    expect(
      gameStory(
        game([7, 7, 7, 3], [7, 0, 3, 3], { totalYds: 300, turnovers: 0 }, { totalYds: 380, turnovers: 3 }),
        true,
      ).takeaway,
    ).toBe('We won the turnover battle 3–0, and that decided it: they outgained us 380 yards to 300.');
  });

  it('tells control, a result against the yardage, a defense that shut the door, and a close one', () => {
    expect(
      gameStory(game([10, 7, 10, 7], [0, 3, 0, 3], { totalYds: 420, top: 38 * 60 }, { totalYds: 190 }), true).takeaway,
    ).toBe('We controlled it from start to finish: 420 yards to 190 and 38:00 of possession.');
    expect(gameStory(game([0, 3, 0, 3], [10, 7, 10, 7], { totalYds: 190 }, { totalYds: 420 }), true).takeaway).toBe(
      'They controlled it from start to finish: 420 yards to 190.',
    );
    // Won while outgained: the red zone explains it when it can.
    expect(
      gameStory(
        game(
          [7, 7, 3, 7],
          [3, 3, 7, 7],
          { totalYds: 280, redZoneAtt: 3, redZoneTd: 3 },
          { totalYds: 390, redZoneAtt: 5, redZoneTd: 1 },
        ),
        true,
      ).takeaway,
    ).toBe('They outgained us 390 yards to 280, but we cashed in 3 touchdowns from 3 trips inside the 20.');
    expect(
      gameStory(
        game(
          [7, 7, 3, 7],
          [3, 3, 7, 7],
          { totalYds: 280, redZoneAtt: 1, redZoneTd: 0 },
          { totalYds: 390, redZoneAtt: 5, redZoneTd: 1 },
        ),
        true,
      ).takeaway,
    ).toBe('They outgained us 390 yards to 280, but we held them to 1 touchdown from 5 trips inside the 20.');
    expect(
      gameStory(
        game([3, 3, 7, 7], [7, 7, 3, 7], { totalYds: 390, redZoneAtt: 6, redZoneTd: 1 }, { totalYds: 280 }),
        true,
      ).takeaway,
    ).toBe('We outgained them 390 yards to 280 but came away with only 1 touchdown from 6 trips inside the 20.');
    // Up 14 at the half and nothing allowed after it.
    expect(gameStory(game([14, 7, 3, 3], [7, 7, 0, 0]), true).takeaway).toBe(
      'The defense shut the door after halftime: nothing allowed after the break.',
    );
    // A one-score game into the fourth, settled by three.
    expect(gameStory(game([7, 7, 3, 7], [7, 7, 7, 0]), true).takeaway).toBe(
      'A one-score game all through the fourth quarter.',
    );
    expect(gameStory(game([7, 7, 3, 7, 3], [7, 7, 7, 3, 0], {}, {}, true), true).takeaway).toBe(
      'Neither side could put it away in regulation.',
    );
    // Nothing to tell: the yards, as before.
    expect(gameStory(game([7, 7, 3, 7], [3, 7, 0, 7], { totalYds: 350 }, { totalYds: 320 }), true)).toEqual({
      swing: '',
      takeaway: 'We outgained them 350 yards to 320.',
    });
  });

  it("gives the player of the game a line in his position's terms", () => {
    const p = (position: string) => ({ position }) as Parameters<typeof statBlurb>[0];
    expect(statBlurb(p('QB'), { passAtt: 30, passYds: 312, passTd: 3 })).toBe('312 yards passing and 3 touchdowns');
    expect(statBlurb(p('QB'), { passAtt: 30, passYds: 212, passTd: 1, passInt: 2 })).toBe(
      '212 yards passing and 1 touchdown, with 2 interceptions',
    );
    expect(statBlurb(p('RB'), { rushAtt: 1, rushYds: 4 })).toBe('4 yards on 1 carry');
    expect(statBlurb(p('WR'), { rec: 9, recYds: 131, recTd: 1 })).toBe('9 catches for 131 yards and 1 touchdown');
    expect(statBlurb(p('EDGE'), { sacks: 2.5, tackles: 6 })).toBe('2.5 sacks and 6 tackles');
    expect(statBlurb(p('CB'), { defInt: 2, tackles: 5, forcedFum: 1 })).toBe('2 interceptions and 1 forced fumble');
    expect(statBlurb(p('K'), { fgAtt: 4, fgMade: 4 })).toBe('4 of 4 field goals');
    expect(statBlurb(p('OL'), { penalties: 1 })).toBe('');
  });
});

describe('a trade conversation in the inbox', () => {
  /** An enquiry, the bid it drew and a counter to that bid, found by trying seeds until one goes all the way. */
  function chain() {
    for (let i = 0; i < 6; i++) {
      const l = createLeague({ seed: `trades-${i}` });
      let enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
      for (let w = 0; w < 9 && !enquiry; w++) {
        playWeek(l);
        enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
      }
      if (!enquiry) continue;
      deliverMail(l);
      const { offer: bid } = answerEnquiry(l, enquiry.id, 'offer');
      if (!bid) continue;
      deliverMail(l);
      // A counter he is to throw in every pick he owns for: legal, never worth it to him.
      const filler = activeRoster(l, l.userTeamId)
        .filter((p) => !bid.sides[1].players.includes(p.id))
        .sort((a, b) => playerOvr(a) - playerOvr(b))
        .slice(0, bid.sides[0].players.length)
        .map((p) => p.id);
      const greedy: TradeProposal = {
        sides: [
          { ...bid.sides[1], players: [...bid.sides[1].players, ...filler] },
          { ...bid.sides[0], picks: l.draftPicks.filter((p) => p.ownerId === bid.teamId).map((p) => p.id) },
        ],
      };
      const r = counterOffer(l, bid.id, greedy);
      if (r.result !== 'countered') continue;
      deliverMail(l);
      return { l, enquiry, bid, counter: r.offer! };
    }
    throw new Error('no seed gave an enquiry, a bid and a counter');
  }

  it('folds an enquiry, its bid and the counter into one thread', () => {
    const { l, enquiry, bid, counter } = chain();
    const offerMessages = l.inbox!.filter((m) => m.id.startsWith('offer:'));
    expect(offerMessages.length).toBeGreaterThanOrEqual(3);
    for (const o of [enquiry, bid, counter]) {
      const m = l.inbox!.find((x) => x.id === `offer:${o.season}:${o.id}:${enquiry.id}`);
      expect(m, `mail for offer ${o.id}`).toBeDefined();
    }
    // Other teams' offers on the desk keep their own threads.
    const found = threads(l.inbox!).filter((t) => t.messages.some((m) => m.id === offerMailId(l, enquiry)));
    expect(found).toHaveLength(1);
    const [thread] = found;
    expect(thread.messages).toHaveLength(3);
    expect(thread.messages.map((m) => m.id).sort()).toEqual(
      [enquiry, bid, counter].map((o) => offerMailId(l, o)).sort(),
    );
    expect(thread.kind).toBe('offer');
    expect(thread.messages.every((m) => mailSubject(m)?.kind === 'offer')).toBe(true);
    expect(threadLabel(thread).subject).toBe(`${thread.messages[0].subject} (${thread.messages.length} messages)`);
  });

  it('reads the root off an offer mail id, and an old id without one is its own root', () => {
    const msg = (id: string) => ({ id, actions: [] }) as unknown as Parameters<typeof mailSubject>[0];
    expect(mailSubject(msg('offer:2026:7'))).toEqual({ kind: 'offer', season: 2026, offerId: 7, root: 7 });
    expect(mailSubject(msg('offer:2026:9:7'))).toEqual({ kind: 'offer', season: 2026, offerId: 9, root: 7 });
  });

  it('finds a reply filed under an old 3-segment id, and id 1 never matches id 10', () => {
    const { l, bid } = chain();
    const filed = l.inbox!.find((m) => m.id === offerMailId(l, bid))!;
    expect(mailForOffer(l, bid)).toBe(filed);
    filed.id = `offer:${bid.season}:${bid.id}`;
    expect(mailForOffer(l, bid)).toBe(filed);
    const other = { ...bid, id: bid.id * 10 };
    expect(mailForOffer(l, other)).toBeUndefined();
    const tens = { ...bid, id: bid.id * 10 };
    filed.id = `offer:${bid.season}:${tens.id}:${bid.id}`;
    expect(mailForOffer(l, bid)).toBeUndefined();
    expect(mailForOffer(l, tens)).toBe(filed);
  });
});

describe('offer text', () => {
  it('leaves a live projection to the card: an unmade pick has no "proj. No." in the mail', () => {
    const l = createLeague({ seed: 'offer-words' });
    const user = l.userTeamId;
    const other = l.teams.find((t) => t.id !== user)!;
    const pick = l.draftPicks.find((p) => p.ownerId === other.id && !p.overall)!;
    const mine = teamPlayers(l, user)[0];
    expect(pick, 'an unmade pick').toBeDefined();
    const bid: TradeOffer = {
      id: 1,
      teamId: other.id,
      sides: [
        { teamId: other.id, players: [], picks: [pick.id] },
        { teamId: user, players: [mine.id], picks: [] },
      ],
      kind: 'sale',
      reason: 'bid',
      season: l.season,
      phase: l.phase,
      week: l.week,
      moment: 0,
      status: 'pending',
      patience: 0,
      worth: 0,
    };
    const { body } = offerWords(l, bid);
    expect(body).toContain(`${pick.season} round ${pick.round}`);
    expect(body).not.toMatch(/proj\. No\./);
  });
});

describe('flex mail', () => {
  it('files one message per move, keyed by the game', () => {
    const l = createLeague({ seed: 'flex-mail' });
    const g = l.games.find((x) => x.season === l.season && (x.homeId === l.userTeamId || x.awayId === l.userTeamId))!;
    g.flexed = { day: 'sun', et: 13 };
    g.kickoff = { day: 'mon', et: 20 };
    deliverMail(l);
    const mail = l.inbox!.find((m) => m.id.startsWith(`flex:${g.season}:${g.id}:`))!;
    expect(mail).toBeDefined();
    expect(mailSubject(mail)).toEqual({ kind: 'flex', season: g.season, gameId: g.id });
  });
});

describe('key matchups', () => {
  const TITLES = ['Trenches', 'Run game', 'Pass game'];
  it('pairs each offensive unit with the defensive unit it faces, both ways', () => {
    const league = createLeague({ seed: 'matchups' });
    const user = league.userTeamId;
    const opp = user === 1 ? 2 : 1;
    const { attack, defend } = keyMatchups(league, opp);
    expect(attack.map((m) => m.title)).toEqual(TITLES);
    expect(defend.map((m) => m.title)).toEqual(TITLES);
    const ours = unitReads(league, user);
    const theirs = unitReads(league, opp);
    const read = (units: typeof ours, title: string) => units.find((u) => u.title === title)!;
    // Our line against their front, their backs against our linebackers.
    expect(attack[0].offense).toEqual(read(ours, 'Offensive line'));
    expect(attack[0].defense).toEqual(read(theirs, 'Defensive front'));
    expect(defend[1].offense).toEqual(read(theirs, 'Backfield'));
    expect(defend[1].defense).toEqual(read(ours, 'Linebackers'));
    // The passing game is the quarterback and his receivers together, led by the quarterback.
    expect(attack[2].offense.score).toBeCloseTo((read(ours, 'Quarterback').score + read(ours, 'Receivers').score) / 2);
    expect(attack[2].offense.lead).toBe(read(ours, 'Quarterback').lead);
    for (const [side, offenseTeam] of [
      [attack, user],
      [defend, opp],
    ] as const) {
      for (const m of side) {
        for (const u of [m.offense, m.defense]) {
          expect(u.score).toBeGreaterThanOrEqual(0);
          expect(u.score).toBeLessThanOrEqual(1);
        }
        const gap = m.offense.score - m.defense.score;
        if (Math.abs(gap) < EDGE_GAP) expect(m.edge).toBeNull();
        else expect(m.edge).toBe(gap > 0 === (offenseTeam === user) ? 'ours' : 'theirs');
        expect(league.players[m.offense.lead!].teamId).toBe(offenseTeam);
        expect(league.players[m.defense.lead!].teamId).toBe(offenseTeam === user ? opp : user);
      }
    }
  });

  it("ranks each unit against the league's same unit, so a typical one reads 50th", () => {
    const league = createLeague({ seed: 'matchups' });
    const all = league.teams.map((t) => unitReads(league, t.id));
    for (let g = 0; g < all[0].length; g++) {
      const scores = all.map((units) => units[g].score).sort((a, b) => a - b);
      const median = (scores[15] + scores[16]) / 2;
      expect(median, all[0][g].title).toBeCloseTo(0.5, 1);
      // The ends of the league (a tie there sits a little inside).
      expect(scores[0]).toBeLessThan(0.05);
      expect(scores.at(-1)).toBeGreaterThan(0.95);
    }
  });

  it('still reads a unit with nobody in it', () => {
    const league = createLeague({ seed: 'matchups' });
    const opp = league.userTeamId === 1 ? 2 : 1;
    league.teams[opp].depthChart.DT = [];
    league.teams[opp].depthChart.EDGE = [];
    const { attack } = keyMatchups(league, opp);
    expect(attack).toHaveLength(3);
    expect(attack[0].defense.lead).toBeUndefined();
    expect(attack[0].defense.score).toBe(0);
  });
});

describe('short positions in the inbox', () => {
  const base = createLeague({ seed: 'inbox-cover' });
  const fresh = () => copy(base);
  const hurtFor = (l: League, p: Player, weeks: number) =>
    applyInjury(l, p, {
      type: 'hamstring',
      severity: 'moderate',
      weeksRemaining: weeks,
      estimate: [weeks, weeks],
      season: l.season,
      week: l.week,
      where: 'game',
    });
  /** All but `NEED.S - 1` of your safeties hurt: the position is short. */
  const shortAtSafety = (l: League) =>
    teamPlayers(l, l.userTeamId)
      .filter((p) => p.position === 'S')
      .slice(NEED.S - 1)
      .forEach((p) => hurtFor(l, p, 2));
  const rate = (p: Player, r: number) => {
    for (const k of Object.keys(p.ratings)) p.ratings[k as keyof Ratings] = r;
  };
  const byKind = (l: League, kind: string) => l.inbox!.filter((m) => mailSubject(m)?.kind === kind);

  it('names the player staff lined up at a short position', () => {
    const l = fresh();
    const team = l.teams[l.userTeamId];
    const spare = l.players[team.depthChart.LB.at(-1)!];
    rate(spare, 13);
    shortAtSafety(l);
    manageInjuries(l, team, new Rng('cover'));
    deliverMail(l);
    const [m] = byKind(l, 'covering');
    expect(mailSubject(m)).toMatchObject({ kind: 'covering', playerId: spare.id, pos: 'S' });
    expect(m.from).toContain('Head coach');
    expect(m.actions).toContainEqual({ kind: 'player', playerId: spare.id });
    expect(needsYou(l, m)).toBe(false);
    expect(byKind(l, 'shortHanded')).toHaveLength(0);
    // Delivered again, and a week later with the cover still on: once.
    deliverMail(l);
    l.week++;
    deliverMail(l);
    expect(byKind(l, 'covering')).toHaveLength(1);
  });

  it('says a position is short when nobody can cover, and links to free agency there', () => {
    const l = fresh();
    const team = l.teams[l.userTeamId];
    for (const p of teamPlayers(l, team.id)) if (p.position !== 'S') rate(p, 1);
    shortAtSafety(l);
    manageInjuries(l, team, new Rng('cover'));
    deliverMail(l);
    const [m] = byKind(l, 'shortHanded');
    expect(mailSubject(m)).toMatchObject({ kind: 'shortHanded', pos: 'S' });
    expect(m.actions).toContainEqual({ kind: 'fa', pos: 'S' });
    expect(needsYou(l, m)).toBe(true);
    const diagnosis = byKind(l, 'injury').find((m) => m.subject.includes('short at S'))!;
    expect(diagnosis.body).toMatch(/available safet(?:y|ies)/);
    expect(diagnosis.body).toContain('We need three for normal cover');
    expect(diagnosis.body).toContain('take a look at free agents');
    // Still short a week later: the same message stands, no second one.
    l.week++;
    deliverMail(l);
    expect(byKind(l, 'shortHanded')).toHaveLength(1);
    for (const p of teamPlayers(l, team.id)) if (p.position === 'S') delete p.injury;
    expect(needsYou(l, m)).toBe(false);
  });

  it('a healed player waiting on IR for a spot needs you, with the staff handling injuries', () => {
    const l = fresh();
    const team = l.teams[l.userTeamId];
    const p = teamPlayers(l, team.id).find((x) => x.position === 'LB')!;
    hurtFor(l, p, 5);
    deliverMail(l);
    placeOnIr(l, p);
    delete p.injury;
    p.ir!.weeks = IR_MIN_WEEKS;
    const fa = generatePlayer(new Rng('inbox-fa'), {
      id: l.nextPlayerId++,
      position: 'WR',
      quality: 9,
      age: 27,
      teamId: null,
      jerseysUsed: new Set(),
    });
    l.players[fa.id] = fa;
    signPlayer(l, fa, team.id, { years: 1, apy: 2000, bonusPct: 0, gtdPct: 0, voidYears: 0 });
    expect(activeRoster(l, team.id)).toHaveLength(53);
    deliverMail(l);
    const [m] = byKind(l, 'cleared');
    expect(m.body).toContain('make room');
    expect(needsYou(l, m)).toBe(true);
    releasePlayer(l, fa);
    expect(needsYou(l, m)).toBe(false);
  });
});

describe('mail from another club', () => {
  it('v47 backfills the sending club on other front offices’ mail', () => {
    const l = createLeague({ seed: 'club-backfill' });
    const t = l.teams[7];
    const base = {
      season: l.season,
      phase: 'regular' as const,
      week: 3,
      category: 'trades' as const,
      read: true,
      actions: [],
    };
    l.inbox = [
      { ...base, id: 'a', from: `${t.city} ${t.name} front office`, subject: 'Offer', body: '' },
      { ...base, id: 'b', from: 'The owner', subject: 'Hi', body: '' },
    ];
    l.version = 46;
    const up = migrateLeague(l)!;
    expect(up.inbox![0].fromTeamId).toBe(7);
    expect(up.inbox![1].fromTeamId).toBeUndefined();
  });
});

describe('the director’s read on a trade', () => {
  const setup = () => {
    const l = createLeague({ seed: 'director-angle' });
    l.phase = 'regular';
    l.week = 5;
    l.market = emptyMarket();
    l.games = [];
    const me = l.teams[l.userTeamId];
    const rival = l.teams.find((t) => t.id !== me.id && t.division === me.division)!;
    const far = l.teams.filter((t) => t.division !== me.division && t.conference !== me.conference);
    const [seller, buyer] = far;
    const p = Object.values(l.players).find((p) => p.teamId === seller.id && p.position === 'LB')!;
    const pick = l.draftPicks.find((d) => d.ownerId === buyer.id && d.round === 3)!;
    const record = (buyerId: number, week = 4) => ({
      season: l.season,
      phase: 'regular' as const,
      week,
      kind: 'rental' as const,
      sides: [
        { teamId: seller.id, players: [p.id], picks: [] },
        { teamId: buyerId, players: [], picks: [pick.id] },
      ] as import('./types').TradeRecord['sides'],
    });
    return { l, me, rival, seller, buyer, p, record };
  };
  it('flags a division rival buying', () => {
    const { l, rival, record } = setup();
    expect(tradeAngle(l, record(rival.id), 4)).toBe('A division rival got stronger at LB.');
  });
  it('sets a price for one of ours at the position', () => {
    const { l, me, buyer, record } = setup();
    const ours = Object.values(l.players).find((p) => p.teamId === me.id && p.position === 'LB')!;
    l.market!.status[ours.id] = 'listed';
    expect(tradeAngle(l, record(buyer.id), 4)).toBe(`A marker for what ${ours.lastName} could fetch.`);
  });
  it('notes we play the seller soon', () => {
    const { l, me, seller, buyer, record } = setup();
    l.games.push({ id: l.nextGameId++, season: l.season, week: 6, homeId: me.id, awayId: seller.id } as Game);
    expect(tradeAngle(l, record(buyer.id), 4)).toBe(`We play the ${seller.name} in Week 6, without him.`);
  });
  it('says nothing when there is no angle', () => {
    const { l, buyer, record } = setup();
    expect(tradeAngle(l, record(buyer.id), 4)).toBeNull();
  });
  it('marks a trade SNN ran and says so in the report', () => {
    const { l, buyer, seller, record } = setup();
    const r = record(buyer.id);
    l.market!.history = [r];
    l.transactions.push({
      season: l.season,
      phase: 'regular',
      week: 4,
      teamIds: [buyer.id, seller.id],
      kind: 'trade',
      text: 'x',
    });
    expect(snnRan(l, r)).toBe(false);
    const base = {
      season: l.season,
      phase: 'regular' as const,
      week: 4,
      read: true,
      actions: [],
      body: '',
      subject: '',
    };
    l.inbox = [{ ...base, id: `press:${l.season}:4:trade:${tradeIdentity(r)}`, from: 'SNN', category: 'league' }];
    expect(snnRan(l, r)).toBe(true);
    expect(marketMail(l, new Set())[0].body).toContain('SNN has already covered it');
  });
  it('keeps the notes the report was filed with, whatever happens afterwards', () => {
    const { l, me, buyer, seller, record } = setup();
    const r = record(buyer.id);
    l.market!.history = [r];
    l.transactions.push({
      season: l.season,
      phase: 'regular',
      week: 4,
      teamIds: [buyer.id, seller.id],
      kind: 'trade',
      text: 'x',
    });
    l.games.push({ id: l.nextGameId++, season: l.season, week: 6, homeId: me.id, awayId: seller.id } as Game);
    const [m] = marketMail(l, new Set());
    expect(m.marketNotes).toEqual([{ note: `We play the ${seller.name} in Week 6, without him.` }]);
    l.games = [];
    l.inbox = [{ ...m, read: false, id: `press:${l.season}:4:trade:${tradeIdentity(r)}` }];
    expect(m.marketNotes).toEqual([{ note: `We play the ${seller.name} in Week 6, without him.` }]);
  });
  it('maps two deals between the same clubs in one week to their own records', () => {
    const { l, buyer, seller, record } = setup();
    const a = record(buyer.id),
      b = { ...record(buyer.id), kind: 'buy' as const };
    l.market!.history = [a, b];
    const t = {
      season: l.season,
      phase: 'regular' as const,
      week: 4,
      teamIds: [buyer.id, seller.id],
      kind: 'trade' as const,
      text: 'x',
    };
    expect(tradeRecordFor(l, t, 0)).toBe(a);
    expect(tradeRecordFor(l, t, 1)).toBe(b);
  });
});

describe('arriving at a club', () => {
  const fresh = () => {
    const l = createLeague({ seed: 'onboarding' });
    deliverMail(l);
    return l;
  };
  it('opens with the owner’s welcome, then the head coach’s rundown, then the opposition report, all unread', () => {
    const l = fresh();
    const ids = l.inbox!.map((m) => m.id);
    const welcome = ids.findIndex((id) => id.startsWith(`owner:${l.season}:welcome:`));
    const rundown = ids.findIndex((id) => id.startsWith(`rundown:${l.season}:`));
    const matchup = ids.findIndex((id) => id.startsWith('matchup:'));
    expect(welcome).toBeGreaterThanOrEqual(0);
    expect(rundown).toBeGreaterThan(welcome);
    expect(matchup).toBeGreaterThan(rundown);
    expect(l.inbox![welcome].from).toBe('The owner');
    expect(l.inbox![welcome].read).toBe(false);
    expect(l.inbox![rundown].from).toMatch(/Head coach$/);
    expect(l.inbox![rundown].read).toBe(false);
  });
  it('welcomes once per job', () => {
    const l = fresh();
    const n = l.inbox!.length;
    deliverMail(l);
    expect(l.inbox!.filter((m) => m.id.includes(':welcome:'))).toHaveLength(1);
    expect(l.inbox!.length).toBe(n);
  });
  it('says what the owner expects and what we have to spend', () => {
    const l = fresh();
    const m = l.inbox!.find((x) => x.id.includes(':welcome:'))!;
    expect(m.body).toMatch(/playoffs|wildcard|progress/);
    expect(m.body).toMatch(/coaching/);
    expect(m.body).not.toMatch(/undefined|NaN/);
  });
  it('the rundown names only our players, prospects 24 or younger, with both units ranked', () => {
    const l = fresh();
    const m = l.inbox!.find((x) => x.id.startsWith('rundown:'))!;
    const r = m.rundown!;
    for (const id of [...r.offense, ...r.defense, ...r.prospects]) expect(l.players[id].teamId).toBe(l.userTeamId);
    expect(r.offense.length).toBeGreaterThan(0);
    expect(r.offense.length).toBeLessThanOrEqual(3);
    expect(r.defense.length).toBeLessThanOrEqual(3);
    for (const id of r.prospects) expect(l.players[id].age).toBeLessThanOrEqual(24);
    for (const rank of [r.offenseRank, r.defenseRank]) {
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(32);
    }
    expect(m.body).toContain(`${r.offenseRank}`);
  });
  it('a new job brings a new welcome and rundown; the yearly letter does not double the welcome', () => {
    const l = fresh();
    const gm = l.gms[l.userGmId];
    const to = (l.userTeamId + 9) % 32;
    gm.appointments.push({
      teamId: to,
      start: { season: l.season, phase: l.phase, week: l.week },
      interim: false,
      through: l.season + 2,
    });
    gm.teamId = to;
    l.userTeamId = to;
    deliverMail(l);
    expect(l.inbox!.filter((m) => m.id.includes(':welcome:'))).toHaveLength(2);
    expect(l.inbox!.filter((m) => m.id.startsWith('rundown:'))).toHaveLength(2);
  });
  it('a job taken as the league year opens sends the welcome instead of the yearly letter', () => {
    const l = createLeague({ seed: 'onboarding-resign' });
    l.season++;
    l.phase = 'resign';
    l.week = 0;
    const gm = l.gms[l.userGmId];
    const to = (l.userTeamId + 5) % 32;
    gm.appointments.push({
      teamId: to,
      start: { season: l.season, phase: 'resign', week: 0 },
      interim: false,
      through: l.season + 2,
    });
    gm.teamId = to;
    l.userTeamId = to;
    deliverMail(l);
    expect(l.inbox!.some((m) => m.id.startsWith(`owner:${l.season}:welcome:${to}:`))).toBe(true);
    expect(l.inbox!.some((m) => m.id === `owner:${l.season}:${to}`)).toBe(false);
  });
});
