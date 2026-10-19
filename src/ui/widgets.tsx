/**
 * Home's small panels: our injuries, the opponent's injury report, the mail waiting for us and the season
 * so far. Each is a few rows deep, the rest a click away (the Medical screen, their roster, the inbox). Injuries show
 * the doctor's estimate, never the true layoff, and condition only for our own players.
 */
import { useState } from 'react';
import { capSheet } from '../engine/finance/cap';
import { injuryLabel, weeksLeft } from '../engine/injuries';
import { needsYou } from '../engine/inbox';
import { teamPlayers } from '../engine/roster';
import { computeRecords, conferenceSeeds, divisionStandings } from '../engine/season/standings';
import { teamSeasonStats, type TeamSeasonLine } from '../engine/stats';
import type { Game, InboxMessage, League, Player, Team } from '../engine/types';
import { useNav } from './App';
import { Panel } from './components';
import { money, ordinal, PHASE_LABELS, recordText, shortName, weekLabel } from './format';
import { hurtList, wornDown } from './injuries';

/** How many rows a widget shows before "See all". */
const SHOW = 3;

/** A hurt player's outlook in a pill's words: "IR · season", "Out 2–3 wk", "Playing hurt", "IR · ready". */
export function outlookPill(league: League, p: Player): string {
  const i = p.injury;
  if (!i) return 'IR · ready';
  if (i.injected) return 'Playing hurt';
  const [lo, hi] = i.estimate;
  const out = lo >= weeksLeft(league) ? 'season' : hi <= 1 ? '1 wk' : lo === hi ? `${lo} wk` : `${lo}–${hi} wk`;
  return p.ir ? `IR · ${out}` : out === 'season' ? 'Out for season' : `Out ${out}`;
}

function PlayerRow({ p, note, pill, tone }: { p: Player; note: string; pill: string; tone: 'bad' | 'warn' }) {
  const nav = useNav();
  return (
    <div className="widget-row">
      <span className="pos">{p.position}</span>
      <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
        {shortName(p)}
      </button>
      <span className="muted small">{note}</span>
      <span className={`tag-pill tag-${tone}`}>{pill}</span>
    </div>
  );
}

/** "+2 more" and the link to the rest. */
function More({ rest, label, link, go }: { rest: number; label: string; link: string; go: () => void }) {
  return (
    <div className="widget-more">
      <span className="muted">
        +{rest} {label}
      </span>
      <button className="linklike" onClick={go}>
        {link}
      </button>
    </div>
  );
}

/** Who's out, who's on reserve and who's worn down, the longest layoffs first. */
export function YourInjuries({ league }: { league: League }) {
  const nav = useNav();
  const user = league.userTeamId;
  const hurt = hurtList(league, user);
  const worn = wornDown(league, user);
  const rows = [
    ...hurt.map((p) => ({ p, note: p.injury ? injuryLabel(p.injury.type) : 'Healed', pill: outlookPill(league, p), tone: p.injury?.injected ? ('warn' as const) : ('bad' as const) })),
    ...worn.map((p) => ({ p, note: `Condition ${Math.round(p.condition ?? 100)}%`, pill: 'Worn', tone: 'warn' as const })),
  ];
  const medical = () => nav.go({ view: 'office', tab: 'medical' });
  const rest = rows.length - SHOW;
  const facts: [string, number][] = [
    ['Out', hurt.filter((p) => p.injury && !p.ir && !p.injury.injected).length],
    ['On IR', hurt.filter((p) => p.ir).length],
    ['Worn down', worn.length],
  ];
  return (
    <Panel
      className="widget"
      title="Your injuries"
      action={
        <button className="btn btn-sm btn-ghost" onClick={medical}>
          Medical
        </button>
      }
    >
      <div className="facts">
        {facts.map(([label, n]) => (
          <span className="fact" key={label}>
            <span className="eyebrow">{label}</span>
            <b className="num">{n}</b>
          </span>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Nobody is hurt or worn down.
        </p>
      ) : (
        <div>
          {rows.slice(0, SHOW).map((r) => (
            <PlayerRow key={r.p.id} {...r} />
          ))}
        </div>
      )}
      {rest > 0 && <More rest={rest} label={rows.slice(SHOW).every((r) => r.pill === 'Worn') ? 'more worn down' : 'more'} link={`See all ${rows.length}`} go={medical} />}
    </Panel>
  );
}

/** The opponent's injury report for the next game, longest layoffs first: public, like every injury. */
export function TheirInjuries({ league, opp, game }: { league: League; opp: Team; game: Game }) {
  const nav = useNav();
  const hurt = hurtList(league, opp.id);
  const report = league.inbox?.find((m) => m.id === `matchup:${game.season}:${game.week}`);
  const rest = hurt.length - SHOW;
  return (
    <div className="widget-sub">
      <div className="widget-sub-head">
        <span className="eyebrow">{opp.name} injury report</span>
        {report && (
          <button className="linklike small" onClick={() => nav.go({ view: 'inbox', messageId: report.id })}>
            Opposition report
          </button>
        )}
      </div>
      {hurt.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Nobody on it this week.
        </p>
      ) : (
        <div>
          {hurt.slice(0, SHOW).map((p) => (
            <PlayerRow key={p.id} p={p} note={p.injury ? injuryLabel(p.injury.type) : 'Healed'} pill={outlookPill(league, p)} tone={p.injury?.injected ? 'warn' : 'bad'} />
          ))}
        </div>
      )}
      {rest > 0 && <More rest={rest} label="more (longest layoffs first)" link={`See all ${hurt.length}`} go={() => nav.openTeam(opp.id)} />}
    </div>
  );
}

/** "Head coach · Week 9", "Kyle James's agent · Re-sign window": who it's from and when, in a line. */
const fromLine = (m: InboxMessage) => `${m.from.split(', ')[1] ?? m.from} · ${m.phase === 'regular' || m.phase === 'playoffs' ? weekLabel(m.week) : PHASE_LABELS[m.phase]}`;

/** What's waiting in the inbox: messages that still need you first, then the unread, newest first. */
export function waitingMail(league: League): { needs: Set<string>; rows: InboxMessage[] } {
  const all = [...(league.inbox ?? [])].reverse();
  const needs = new Set(all.filter((m) => needsYou(league, m)).map((m) => m.id));
  return { needs, rows: [...all.filter((m) => needs.has(m.id)), ...all.filter((m) => !m.read && !needs.has(m.id))] };
}

export function WaitingForYou({ league }: { league: League }) {
  const nav = useNav();
  const { needs, rows } = waitingMail(league);
  const inbox = () => nav.go({ view: 'inbox' });
  const rest = rows.length - SHOW;
  return (
    <Panel
      className="widget"
      title="Waiting for you"
      action={
        <button className="btn btn-sm btn-ghost" onClick={inbox}>
          Inbox
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          You're all caught up.
        </p>
      ) : (
        <div>
          {rows.slice(0, SHOW).map((m) => (
            <button key={m.id} className={`widget-mail${m.read ? '' : ' is-unread'}`} onClick={() => nav.go({ view: 'inbox', messageId: m.id })}>
              <span className={`widget-dot cat-${m.category}`} aria-hidden="true" />
              <span style={{ minWidth: 0 }}>
                {!m.read && <span className="visually-hidden">Unread: </span>}
                <span className="widget-mail-subject">{m.subject}</span>
                <span className="muted small">{fromLine(m)}</span>
              </span>
              {needs.has(m.id) && <span className="needs-pill">Needs you</span>}
            </button>
          ))}
        </div>
      )}
      {rest > 0 && <More rest={rest} label={rows.slice(SHOW).every((m) => !m.read) ? 'more unread' : 'more waiting'} link="See all in Inbox" go={inbox} />}
    </Panel>
  );
}

export interface SeasonFact {
  key: string;
  label: string;
  value: string;
  sub: string;
}

/** What Season so far shows until you pick: where you'd be seeded, the point and turnover margins, what's left. */
export const SEASON_DEFAULT = ['seed', 'diff', 'to', 'left'];
const SEASON_KEY = 'afls.season-facts';
const SEASON_PICKS = 4;

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Every fact Season so far can show, from the box scores and standings as they are now. Ranks are among all 32 teams. */
export function seasonFacts(league: League): SeasonFact[] {
  const user = league.userTeamId;
  const team = league.teams[user];
  const records = computeRecords(league);
  const stats = teamSeasonStats(league);
  const mine = stats.get(user)!;
  const played = mine.games > 0;
  const per = (n: number) => (played ? (n / mine.games).toFixed(1) : '–');
  // 1 = best: one more than the teams better at it (fewest: lower is better).
  const rank = (value: (l: TeamSeasonLine) => number, fewest = false) => {
    if (!played) return 'No games yet';
    const v = value(mine);
    const n = 1 + [...stats.values()].filter((l) => l.games && (fewest ? value(l) < v : value(l) > v)).length;
    return fewest ? (n === 1 ? 'Fewest in the league' : `${ordinal(n)} fewest`) : `${ordinal(n)} in the league`;
  };
  const perGame = (n: (l: TeamSeasonLine) => number) => (l: TeamSeasonLine) => (l.games ? n(l) / l.games : 0);
  const seed = conferenceSeeds(league, team.conference, records).indexOf(user);
  const div = divisionStandings(league, records).find((d) => d.index === team.division)!;
  const left = league.games.filter((g) => g.season === league.season && !g.playoffRound && !g.result && (g.homeId === user || g.awayId === user)).length;
  const total = league.games.filter((g) => g.season === league.season && !g.playoffRound && (g.homeId === user || g.awayId === user)).length;
  const hurt = teamPlayers(league, user).reduce((n, p) => n + (p.injuries ?? []).filter((i) => i.season === league.season).length, 0);
  const third = (l: TeamSeasonLine) => (l.thirdDownAtt ? l.thirdDownConv / l.thirdDownAtt : 0);
  return [
    { key: 'record', label: 'Record', value: recordText(records.get(user)!), sub: `Home ${recordText(mine.home)} · Road ${recordText(mine.road)}` },
    { key: 'seed', label: 'Playoff seed', value: seed >= 0 ? ordinal(seed + 1) : 'Out', sub: league.phase === 'regular' ? (seed >= 0 ? 'If the season ended today' : 'Outside the seven today') : 'Final seeding' },
    { key: 'div', label: 'Division', value: ordinal(div.teams.findIndex((r) => r.teamId === user) + 1), sub: `${div.division.name} · ${recordText(mine.division)} in it` },
    { key: 'diff', label: 'Point diff', value: signed(mine.pointsFor - mine.pointsAgainst), sub: rank(perGame((l) => l.pointsFor - l.pointsAgainst)) },
    { key: 'ppg', label: 'Points per game', value: per(mine.pointsFor), sub: rank(perGame((l) => l.pointsFor)) },
    { key: 'papg', label: 'Points allowed', value: per(mine.pointsAgainst), sub: rank(perGame((l) => l.pointsAgainst), true) },
    { key: 'ypg', label: 'Yards per game', value: per(mine.yards), sub: rank(perGame((l) => l.yards)) },
    { key: 'ya', label: 'Yards allowed', value: per(mine.yardsAllowed), sub: rank(perGame((l) => l.yardsAllowed), true) },
    { key: 'to', label: 'Turnover margin', value: signed(mine.takeaways - mine.giveaways), sub: rank((l) => l.takeaways - l.giveaways) },
    { key: 'third', label: 'Third-down rate', value: mine.thirdDownAtt ? `${(third(mine) * 100).toFixed(1)}%` : '–', sub: rank(third) },
    { key: 'left', label: 'Games left', value: String(left), sub: `of ${total}` },
    { key: 'inj', label: 'Injuries', value: String(hurt), sub: 'this season' },
    { key: 'cap', label: 'Cap space', value: money(Math.round(capSheet(league, user).space)), sub: `${league.season} league year` },
  ];
}

/** Your picks, kept in this browser (a view preference, not part of the save). */
function savedPicks(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SEASON_KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, SEASON_PICKS) : SEASON_DEFAULT;
  } catch {
    return SEASON_DEFAULT;
  }
}

/** Four facts about the season, yours to pick. */
export function SeasonSoFar({ league }: { league: League }) {
  const [picks, setPicks] = useState(savedPicks);
  const [editing, setEditing] = useState(false);
  const facts = seasonFacts(league);
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const shown = picks.map((k) => byKey.get(k)).filter((f): f is SeasonFact => !!f);
  const toggle = (key: string) => {
    const next = picks.includes(key) ? picks.filter((k) => k !== key) : picks.length >= SEASON_PICKS ? picks : [...picks, key];
    setPicks(next);
    try {
      localStorage.setItem(SEASON_KEY, JSON.stringify(next));
    } catch {
      // Private windows and blocked storage: the picks last until the page closes.
    }
  };
  return (
    <Panel
      className="widget"
      title="Season so far"
      action={
        <button className="btn btn-sm" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      }
    >
      {editing ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Pick up to {SEASON_PICKS}. {picks.length} of {SEASON_PICKS} picked.
          </p>
          <div className="season-options">
            {facts.map((f) => {
              const on = picks.includes(f.key);
              return (
                <label key={f.key} className="season-option">
                  <input type="checkbox" checked={on} disabled={!on && picks.length >= SEASON_PICKS} onChange={() => toggle(f.key)} />
                  <span>{f.label}</span>
                  <span className="muted small num">{f.value}</span>
                </label>
              );
            })}
          </div>
        </>
      ) : shown.length ? (
        <div className="season-facts">
          {shown.map((f) => (
            <div className="season-fact" key={f.key}>
              <span className="eyebrow">{f.label}</span>
              <b>{f.value}</b>
              <span className="small muted">{f.sub}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Nothing picked yet: choose up to {SEASON_PICKS} with Edit.
        </p>
      )}
    </Panel>
  );
}
