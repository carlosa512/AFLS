import { useEffect, useState } from 'react';
import { markAllRead, mailSubject, needsYou } from '../../engine/inbox';
import type { InboxAction, InboxCategory, InboxMessage, League } from '../../engine/types';
import { useNav } from '../App';
import { PHASE_LABELS, weekLabel } from '../format';
import { MailCards } from '../mail';
import { store } from '../store';

type Show = 'all' | 'unread' | 'needs';

const TYPES: [InboxCategory | 'all', string][] = [
  ['all', 'All types'],
  ['matchup', 'Matchups'],
  ['medical', 'Medical'],
  ['awards', 'Awards'],
  ['contracts', 'Contracts'],
  ['scouting', 'Scouting'],
  ['trades', 'Trades'],
  ['staff', 'Staff'],
  ['retirement', 'Retirement'],
  ['league', 'League news'],
];

const TAGS: Record<InboxCategory, string> = {
  matchup: 'Matchup',
  medical: 'Medical',
  awards: 'Award',
  contracts: 'Contract',
  scouting: 'Scouting',
  trades: 'Trade',
  staff: 'Staff',
  retirement: 'Retirement',
  league: 'League',
};

/** Messages whose tag says what they are, whatever their category. */
const KIND_TAGS: Partial<Record<NonNullable<ReturnType<typeof mailSubject>>['kind'], string>> = {
  recap: 'Recap',
  race: 'Playoff race',
  deadline: 'Trade deadline',
  owner: 'Owner',
  carousel: 'Coaching',
  faWrap: 'Free agency',
};

/** A tag says what kind of message it is: a recap or the playoff race reads as such, whatever its category. */
function tagOf(m: InboxMessage): string {
  const kind = mailSubject(m)?.kind;
  return (kind && KIND_TAGS[kind]) ?? TAGS[m.category];
}

function actionLabel(league: League, m: InboxMessage, a: InboxAction): string {
  switch (a.kind) {
    case 'player':
      return `${league.players[a.playerId].lastName}'s player card`;
    case 'team':
      return a.teamId === league.userTeamId ? 'Your roster' : `${league.teams[a.teamId].name} roster`;
    case 'resign':
      return 'Expiring contracts';
    case 'fa':
      return 'Free agency';
    case 'coaches':
      return 'Coaches';
    case 'staff':
      return 'Scouting staff';
    case 'cap':
      return 'Cap sheet';
    case 'draft':
      // The draft room keeps the draft history, every team's, under the board.
      return mailSubject(m)?.kind === 'draftClass' ? 'Draft history' : 'Draft room';
    case 'medical':
      return 'Medical';
    case 'game':
      return 'Box score';
    case 'trades':
      return 'Trades';
    case 'standings':
      return 'Standings';
  }
}

const dateLabel = (m: InboxMessage) => `${m.season} · ${m.phase === 'regular' || m.phase === 'playoffs' ? weekLabel(m.week) : PHASE_LABELS[m.phase]}`;

/** "Sean Evans, Head coach" → name and role; "Kyle James's agent" → the agent; "The owner" → O. */
function sender(m: InboxMessage): { name: string; role: string; initials: string } {
  const [name, ...role] = m.from.split(', ');
  const words = name.replace(/'s agent$/, '').replace(/^The /, '').split(' ');
  return { name, role: role.join(', '), initials: (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() };
}

/** A week (or offseason step) of mail under one heading, newest first. */
function groupByDate(messages: InboxMessage[]): { label: string; messages: InboxMessage[] }[] {
  const groups: { label: string; messages: InboxMessage[] }[] = [];
  for (const m of messages) {
    const label = dateLabel(m);
    if (groups.at(-1)?.label === label) groups.at(-1)!.messages.push(m);
    else groups.push({ label, messages: [m] });
  }
  return groups;
}

/** Mail from the league office, agents and your own staff, newest first: a list to sort through and a message to act on. */
export function Inbox({ league }: { league: League }) {
  const nav = useNav();
  const [show, setShow] = useState<Show>('all');
  const [type, setType] = useState<InboxCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const all = [...(league.inbox ?? [])].reverse();
  const needs = new Set(all.filter((m) => needsYou(league, m)).map((m) => m.id));
  const unread = all.filter((m) => !m.read).length;
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (m) =>
      (type === 'all' || m.category === type) &&
      (show === 'all' || (show === 'unread' ? !m.read : needs.has(m.id))) &&
      (!q || `${m.subject} ${m.from} ${m.body}`.toLowerCase().includes(q)),
  );
  const open = all.find((m) => m.id === openId);
  const at = open ? shown.findIndex((m) => m.id === open.id) : -1;

  const read = (m: InboxMessage) => {
    setOpenId(m.id);
    // On a phone the message replaces the list: start it at the top.
    window.scrollTo({ top: 0 });
    if (!m.read) store.mutate((l) => void (l.inbox!.find((x) => x.id === m.id)!.read = true));
  };
  // A wide screen opens the first message that needs you (else the newest), like a mail app's reading pane; a phone starts on the list.
  useEffect(() => {
    const first = all.find((m) => needs.has(m.id)) ?? all[0];
    if (first && window.matchMedia('(min-width: 641px)').matches) read(first);
    // Once, on arrival: after that the user picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = (a: InboxAction) => {
    if (a.kind === 'player') nav.openPlayer(a.playerId);
    else if (a.kind === 'team') nav.openTeam(a.teamId);
    else if (a.kind === 'game') nav.openGame(a.gameId);
    else if (a.kind === 'standings') nav.go({ view: 'standings' });
    else if (a.kind === 'cap') nav.go({ view: 'cap' });
    else nav.go({ view: 'office', tab: a.kind });
  };
  const filters: [Show, string, number][] = [
    ['all', 'All', all.length],
    ['unread', 'Unread', unread],
    ['needs', 'Needs you', needs.size],
  ];

  return (
    <section className={`panel inbox${open ? ' has-open' : ''}`}>
      <div className="inbox-panes">
        <div className="inbox-list-pane">
          <div className="inbox-tools">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Messages</h2>
              <button className="btn btn-sm" disabled={unread === 0} onClick={() => store.mutate(markAllRead)}>
                ✓ Mark all read
              </button>
            </div>
            <div className="seg inbox-show" role="group" aria-label="Show">
              {filters.map(([key, label, n]) => (
                <button key={key} aria-pressed={show === key} onClick={() => setShow(key)}>
                  {label} <span className="num">{n}</span>
                </button>
              ))}
            </div>
            <div className="inbox-search">
              <input type="search" aria-label="Search messages" placeholder="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select aria-label="Message type" value={type} onChange={(e) => setType(e.target.value as InboxCategory | 'all')}>
                {TYPES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="inbox-list" aria-label="Messages">
            {shown.length === 0 && (
              <p className="muted" style={{ padding: '12px 14px', margin: 0 }}>
                {all.length === 0 ? 'Nothing here yet.' : 'Nothing matches. Switch to All to see every message.'}
              </p>
            )}
            {groupByDate(shown).map((g) => (
              <div key={g.label}>
                <div className="inbox-group eyebrow">{g.label}</div>
                {g.messages.map((m) => {
                  const who = sender(m);
                  return (
                    <button key={m.id} className={`inbox-row${m.read ? '' : ' is-unread'}`} aria-current={m.id === openId ? 'true' : undefined} onClick={() => read(m)}>
                      <span className={`mail-av cat-${m.category}`} aria-hidden="true">
                        {who.initials}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="inbox-from">
                          {!m.read && (
                            <>
                              <span className="unread-dot" aria-hidden="true" />
                              <span className="visually-hidden">Unread: </span>
                            </>
                          )}
                          {m.from}
                        </span>
                        <span className="inbox-subject">{m.subject}</span>
                      </span>
                      <span className="inbox-tags">
                        <span className={`mail-tag cat-${m.category}`}>{tagOf(m)}</span>
                        {needs.has(m.id) && <span className="needs-pill">Needs you</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <article className="inbox-message" aria-live="polite">
          {open ? (
            <>
              <div className="inbox-nav">
                <button className="btn btn-sm btn-ghost inbox-back" onClick={() => setOpenId(null)}>
                  ‹ Inbox
                </button>
                {at >= 0 && (
                  <span className="row" style={{ gap: 4 }}>
                    <span className="muted small">
                      {at + 1} of {shown.length}
                    </span>
                    <button className="btn btn-sm btn-ghost" disabled={at <= 0} onClick={() => read(shown[at - 1])} aria-label="Newer message">
                      ▲
                    </button>
                    <button className="btn btn-sm btn-ghost" disabled={at >= shown.length - 1} onClick={() => read(shown[at + 1])} aria-label="Older message">
                      ▼
                    </button>
                  </span>
                )}
              </div>
              <MessageHead m={open} needs={needs.has(open.id)} />
              <p className="inbox-body">{open.body}</p>
              <MailCards league={league} message={open} />
              {open.actions.length > 0 && (
                <div className="row">
                  {open.actions.map((a, i) => (
                    <button key={i} className={`btn btn-sm${i === 0 ? ' btn-primary' : ''}`} onClick={() => act(a)}>
                      {actionLabel(league, open, a)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Pick a message to read it.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function MessageHead({ m, needs }: { m: InboxMessage; needs: boolean }) {
  const nav = useNav();
  const who = sender(m);
  return (
    <header className="inbox-head">
      <span className={`mail-av mail-av-lg cat-${m.category}`} aria-hidden="true">
        {who.initials}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="small">
          {m.fromCard ? (
            <button className="linklike" style={{ fontWeight: 700 }} onClick={() => nav.openStaff(m.fromCard!.kind, m.fromCard!.id)}>
              {who.name}
            </button>
          ) : (
            <b>{who.name}</b>
          )}
          <span className="muted">
            {who.role && ` · ${who.role}`} · {dateLabel(m)}
          </span>
        </div>
        <h3>{m.subject}</h3>
      </div>
      <span className="inbox-tags">
        <span className={`mail-tag cat-${m.category}`}>{tagOf(m)}</span>
        {needs && <span className="needs-pill">Needs you</span>}
      </span>
    </header>
  );
}
