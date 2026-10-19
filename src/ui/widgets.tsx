/**
 * Home's small panels: our injuries, the opponent's injury report and the mail waiting for us. Each is
 * a few rows deep, the rest a click away (the Medical screen, their roster, the inbox). Injuries show
 * the doctor's estimate, never the true layoff, and condition only for our own players.
 */
import { injuryLabel, weeksLeft } from '../engine/injuries';
import { needsYou } from '../engine/inbox';
import { teamPlayers } from '../engine/roster';
import type { Game, InboxMessage, League, Player, Team } from '../engine/types';
import { useNav } from './App';
import { Panel } from './components';
import { PHASE_LABELS, shortName, weekLabel } from './format';
import { WORN_DOWN } from './injuries';

/** How many rows a widget shows before "See all". */
const SHOW = 3;

/** A team's hurt players, longest layoff first by the doctor's estimate; a healed man still on reserve last. */
export function hurtList(league: League, teamId: number): Player[] {
  const est = (p: Player) => (p.injury ? p.injury.estimate[1] * 100 + p.injury.estimate[0] : -1);
  return teamPlayers(league, teamId)
    .filter((p) => p.injury || p.ir)
    .sort((a, b) => est(b) - est(a));
}

/** A hurt player's outlook in a pill's words: "IR · season", "Out 2–3 wk", "Playing hurt", "IR · ready". */
export function outlookPill(league: League, p: Player): string {
  const i = p.injury;
  if (!i) return 'IR · ready';
  if (i.injected) return 'Playing hurt';
  const [lo, hi] = i.estimate;
  const out = lo >= weeksLeft(league) ? 'season' : hi <= 1 ? '1 wk' : lo === hi ? `${lo} wk` : `${lo}–${hi} wk`;
  return p.ir ? `IR · ${out}` : out === 'season' ? 'Out for season' : `Out ${out}`;
}

/** Our healthy players running low on condition, the most tired first. */
export function wornDown(league: League, teamId: number): Player[] {
  return teamPlayers(league, teamId)
    .filter((p) => !p.injury && !p.ir && (p.condition ?? 100) < WORN_DOWN)
    .sort((a, b) => (a.condition ?? 100) - (b.condition ?? 100));
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
