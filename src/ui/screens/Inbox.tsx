import { useEffect, useState } from 'react';
import {
  archiveMail,
  archiveRead,
  deleteMail,
  inInbox,
  mailSubject,
  markAllRead,
  memberTitle,
  needsYou,
  threadLabel,
  threads,
  type MailThread,
} from '../../engine/inbox';
import type { InboxAction, InboxCategory, InboxMessage, League } from '../../engine/types';
import { useNav } from '../App';
import { PHASE_LABELS, weekLabel } from '../format';
import { InjuryTag } from '../injuries';
import { MailCards } from '../mail';
import { LinkedText, nameIndex, type MoveIndex, type Who } from '../moves';
import { store } from '../store';

type Show = 'all' | 'unread' | 'needs' | 'archived';

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
  offer: 'Offer',
  market: 'Market',
  marketRecap: 'Deadline recap',
  owner: 'Owner',
  carousel: 'Coaching',
  faWrap: 'Free agency',
  positionOffer: 'Training',
  positionMoved: 'Training',
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

const dateLabel = (m: InboxMessage) =>
  `${m.season} · ${m.phase === 'regular' || m.phase === 'playoffs' ? weekLabel(m.week) : PHASE_LABELS[m.phase]}`;

/** "Sean Evans, Head coach" → name and role; "Kyle James's agent" → the agent; "The owner" → O. */
function sender(from: string): { name: string; role: string; initials: string } {
  const [name, ...role] = from.split(', ');
  const words = name
    .replace(/'s agent$/, '')
    .replace(/^The /, '')
    .split(' ');
  return {
    name,
    role: role.join(', '),
    initials: (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase(),
  };
}

/** Who a message is about: its players, the staff member who signs it, the coach it reports gone. Their names link first. */
function aboutOf(m: InboxMessage): Who[] {
  const out: Who[] = m.actions.flatMap((a): Who[] => (a.kind === 'player' ? [{ kind: 'player', id: a.playerId }] : []));
  if (m.fromCard) out.push(m.fromCard);
  const s = mailSubject(m);
  if (s?.kind === 'poached') out.push({ kind: 'coach', id: s.coachId });
  return out;
}

/** A week (or offseason step) of mail under one heading, newest first. */
function groupByDate(list: MailThread[]): { label: string; threads: MailThread[] }[] {
  const groups: { label: string; threads: MailThread[] }[] = [];
  for (const t of list) {
    const label = dateLabel(t.messages[0]);
    if (groups.at(-1)?.label === label) groups.at(-1)!.threads.push(t);
    else groups.push({ label, threads: [t] });
  }
  return groups;
}

const ids = (t: MailThread) => t.messages.map((m) => m.id);

/**
 * Mail from the league office, agents and your own staff, newest first: a list to sort through and a message to
 * act on (`messageId`, when sent to one). A day's letters of one kind (contracts, injuries…) fold into one message;
 * anything can be archived or deleted, with an undo.
 */
export function Inbox({ league, messageId }: { league: League; messageId?: string }) {
  const nav = useNav();
  const [show, setShow] = useState<Show>('all');
  const [type, setType] = useState<InboxCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; what: 'archived' | 'deleted' | 'restored' } | null>(null);

  const live = [...(league.inbox ?? [])].reverse().filter((m) => !m.deleted);
  const inbox = live.filter(inInbox);
  const archived = live.filter((m) => m.archived);
  const needs = new Set(inbox.filter((m) => needsYou(league, m)).map((m) => m.id));
  const pool = show === 'archived' ? archived : inbox;
  const q = query.trim().toLowerCase();
  const shown = threads(
    pool.filter(
      (m) =>
        (type === 'all' || m.category === type) &&
        (show === 'all' || show === 'archived' || (show === 'unread' ? !m.read : needs.has(m.id))) &&
        (!q || `${m.subject} ${m.from} ${m.body}`.toLowerCase().includes(q)),
    ),
  );
  // The open thread stays open whatever the filters do to it (reading it takes it out of Unread).
  const open = threads(live).find((t) => t.key === openKey);
  const names = open ? nameIndex(league) : null;
  const at = open ? shown.findIndex((t) => t.key === open.key) : -1;

  const read = (t: MailThread) => {
    setOpenKey(t.key);
    // On a phone the message replaces the list: start it at the top.
    window.scrollTo({ top: 0 });
    if (t.messages.some((m) => !m.read))
      store.mutate((l) => void l.inbox!.forEach((m) => t.messages.some((x) => x.id === m.id) && (m.read = true)));
  };
  // Sent to a message (from Home), open its thread. Otherwise a wide screen opens the first thread that needs you
  // (else the newest), like a mail app's reading pane; a phone starts on the list.
  useEffect(() => {
    const sent = live.find((m) => m.id === messageId);
    if (sent) {
      if (sent.archived) setShow('archived');
      return read(threads(sent.archived ? archived : inbox).find((t) => t.messages.includes(sent))!);
    }
    const all = threads(inbox);
    const first = all.find((t) => t.messages.some((m) => needs.has(m.id))) ?? all[0];
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
  /** Archive, restore or delete the open thread, then move on to the next one in the list (as a mail app does). */
  const file = (t: MailThread, what: 'archived' | 'deleted' | 'restored') => {
    const next = shown[at + 1] ?? shown[at - 1];
    store.mutate((l) => (what === 'deleted' ? deleteMail(l, ids(t)) : archiveMail(l, ids(t), what === 'archived')));
    setUndo({ ids: ids(t), what });
    if (next && next.key !== t.key && window.matchMedia('(min-width: 641px)').matches) read(next);
    else setOpenKey(null);
  };
  const undoIt = () => {
    if (!undo) return;
    store.mutate((l) =>
      undo.what === 'deleted' ? deleteMail(l, undo.ids, false) : archiveMail(l, undo.ids, undo.what === 'restored'),
    );
    setUndo(null);
  };
  const tidy = () => {
    const before = new Set(archived.map((m) => m.id));
    store.mutate(archiveRead);
    setUndo({
      ids: (league.inbox ?? []).filter((m) => m.archived && !before.has(m.id)).map((m) => m.id),
      what: 'archived',
    });
  };
  const count = (list: InboxMessage[], keep: (m: InboxMessage) => boolean) =>
    threads(list).filter((t) => t.messages.some(keep)).length;
  const filters: [Show, string, number][] = [
    ['all', 'All', threads(inbox).length],
    ['unread', 'Unread', count(inbox, (m) => !m.read)],
    ['needs', 'Needs you', count(inbox, (m) => needs.has(m.id))],
    ['archived', 'Archived', threads(archived).length],
  ];
  const unread = inbox.some((m) => !m.read);
  const tidyable = inbox.some((m) => m.read && !needs.has(m.id));

  return (
    <section className={`panel inbox${open ? ' has-open' : ''}`}>
      <div className="inbox-panes">
        <div className="inbox-list-pane">
          <div className="inbox-tools">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Messages</h2>
              <span className="row" style={{ gap: 6 }}>
                <button
                  className="btn btn-sm"
                  disabled={!tidyable}
                  title="Archive every message you've read that no longer needs you"
                  onClick={tidy}
                >
                  Archive read
                </button>
                <button className="btn btn-sm" disabled={!unread} onClick={() => store.mutate(markAllRead)}>
                  ✓ Mark all read
                </button>
              </span>
            </div>
            {undo && undo.ids.length > 0 && (
              <div className="inbox-undo" role="status">
                <span>
                  {undo.what === 'restored'
                    ? 'Moved back to the inbox'
                    : undo.what === 'archived'
                      ? 'Archived'
                      : 'Deleted'}
                  : {undo.ids.length} message{undo.ids.length === 1 ? '' : 's'}.
                </span>
                <button className="linklike" onClick={undoIt}>
                  Undo
                </button>
              </div>
            )}
            <div className="seg inbox-show" role="group" aria-label="Show">
              {filters.map(([key, label, n]) => (
                <button key={key} aria-pressed={show === key} onClick={() => setShow(key)}>
                  {label} <span className="num">{n}</span>
                </button>
              ))}
            </div>
            <div className="inbox-search">
              <input
                type="search"
                aria-label="Search messages"
                placeholder="Search messages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="Message type"
                value={type}
                onChange={(e) => setType(e.target.value as InboxCategory | 'all')}
              >
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
                {show === 'archived'
                  ? 'Nothing archived.'
                  : inbox.length === 0
                    ? 'Nothing here yet.'
                    : 'Nothing matches. Switch to All to see every message.'}
              </p>
            )}
            {groupByDate(shown).map((g) => (
              <div key={g.label}>
                <div className="inbox-group eyebrow">{g.label}</div>
                {g.threads.map((t) => {
                  const label = threadLabel(t);
                  const who = sender(label.from);
                  const lead = t.messages[0];
                  const isUnread = t.messages.some((m) => !m.read);
                  return (
                    <button
                      key={t.key}
                      className={`inbox-row${isUnread ? ' is-unread' : ''}`}
                      aria-current={t.key === openKey ? 'true' : undefined}
                      onClick={() => read(t)}
                    >
                      <span className={`mail-av cat-${lead.category}`} aria-hidden="true">
                        {who.initials}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="inbox-from">
                          {isUnread && (
                            <>
                              <span className="unread-dot" aria-hidden="true" />
                              <span className="visually-hidden">Unread: </span>
                            </>
                          )}
                          {label.from}
                        </span>
                        <span className="inbox-subject">{label.subject}</span>
                      </span>
                      <span className="inbox-tags">
                        <span className={`mail-tag cat-${lead.category}`}>{tagOf(lead)}</span>
                        {t.messages.some((m) => needs.has(m.id)) && <span className="needs-pill">Needs you</span>}
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
                <button className="btn btn-sm btn-ghost inbox-back" onClick={() => setOpenKey(null)}>
                  ‹ Inbox
                </button>
                <span className="row inbox-file" style={{ gap: 4 }}>
                  {open.messages[0].archived ? (
                    <button className="btn btn-sm btn-ghost" onClick={() => file(open, 'restored')}>
                      Move to inbox
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => file(open, 'archived')}>
                      Archive
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => file(open, 'deleted')}>
                    Delete
                  </button>
                </span>
                {at >= 0 && (
                  <span className="row" style={{ gap: 4 }}>
                    <span className="muted small">
                      {at + 1} of {shown.length}
                    </span>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={at <= 0}
                      onClick={() => read(shown[at - 1])}
                      aria-label="Newer message"
                    >
                      ▲
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={at >= shown.length - 1}
                      onClick={() => read(shown[at + 1])}
                      aria-label="Older message"
                    >
                      ▼
                    </button>
                  </span>
                )}
              </div>
              {open.messages.length === 1 ? (
                <Message
                  league={league}
                  m={open.messages[0]}
                  needs={needs.has(open.messages[0].id)}
                  index={names!}
                  act={act}
                />
              ) : (
                <Folded league={league} t={open} needs={needs} index={names!} act={act} />
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

/** One message: its head, its text with everyone in it linked, its cards and its buttons. */
function Message({
  league,
  m,
  needs,
  index,
  act,
}: {
  league: League;
  m: InboxMessage;
  needs: boolean;
  index: MoveIndex;
  act: (a: InboxAction) => void;
}) {
  return (
    <>
      <MessageHead league={league} m={m} from={m.from} subject={m.subject} needs={needs} index={index} />
      <MessageBody league={league} m={m} index={index} act={act} />
    </>
  );
}

function MessageBody({
  league,
  m,
  index,
  act,
  skip = [],
}: {
  league: League;
  m: InboxMessage;
  index: MoveIndex;
  act: (a: InboxAction) => void;
  skip?: InboxAction['kind'][];
}) {
  const actions = m.actions.filter((a) => !skip.includes(a.kind));
  return (
    <>
      <p className="inbox-body">
        <LinkedText league={league} text={m.body} about={aboutOf(m)} index={index} />
      </p>
      <MailCards league={league} message={m} />
      {actions.length > 0 && (
        <div className="row">
          {actions.map((a, i) => (
            <button key={i} className={`btn btn-sm${i === 0 ? ' btn-primary' : ''}`} onClick={() => act(a)}>
              {actionLabel(league, m, a)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** The player a message is about, for a folded row's side note. */
const playerOf = (league: League, m: InboxMessage) => {
  const a = m.actions.find((x) => x.kind === 'player');
  return a?.kind === 'player' ? league.players[a.playerId] : undefined;
};

/**
 * A day's letters of one kind as one message: a row per person, each opening in place to the whole letter. The
 * buttons every letter shares (Expiring contracts, Medical) sit once at the bottom.
 */
function Folded({
  league,
  t,
  needs,
  index,
  act,
}: {
  league: League;
  t: MailThread;
  needs: Set<string>;
  index: MoveIndex;
  act: (a: InboxAction) => void;
}) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const label = threadLabel(t);
  const lead = t.messages[0];
  const allOpen = openIds.length === t.messages.length;
  // Buttons every letter has (not the per-player ones), once.
  const shared = lead.actions.filter(
    (a) =>
      a.kind !== 'player' && a.kind !== 'team' && t.messages.every((m) => m.actions.some((x) => x.kind === a.kind)),
  );
  const skip = shared.map((a) => a.kind);
  const toggle = (id: string) => setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <>
      <MessageHead
        league={league}
        m={lead}
        from={label.from}
        subject={label.subject}
        needs={t.messages.some((m) => needs.has(m.id))}
        index={index}
        folded
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">{t.messages.length} letters in one: open any of them below.</span>
        <button className="linklike small" onClick={() => setOpenIds(allOpen ? [] : t.messages.map((m) => m.id))}>
          {allOpen ? 'Hide all' : 'Show all'}
        </button>
      </div>
      <div className="fold-list">
        {t.messages.map((m) => {
          const p = playerOf(league, m);
          const isOpen = openIds.includes(m.id);
          return (
            <div key={m.id} className={`fold-item${isOpen ? ' is-open' : ''}`}>
              <div className="fold-row">
                <button className="fold-toggle" aria-expanded={isOpen} onClick={() => toggle(m.id)}>
                  <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <span className="fold-title">
                    {p && <span className="pos">{p.position}</span>} {memberTitle(m)}
                  </span>
                </button>
                <span className="inbox-tags fold-side">
                  {p && (t.kind === 'injury' || t.kind === 'cleared') ? (
                    <InjuryTag league={league} p={p} />
                  ) : (
                    p && <span className="muted small">age {p.age}</span>
                  )}
                  {needs.has(m.id) && <span className="needs-pill">Needs you</span>}
                </span>
              </div>
              {isOpen && (
                <div className="fold-body">
                  <MessageBody league={league} m={m} index={index} act={act} skip={skip} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shared.length > 0 && (
        <div className="row">
          {shared.map((a, i) => (
            <button key={i} className={`btn btn-sm${i === 0 ? ' btn-primary' : ''}`} onClick={() => act(a)}>
              {actionLabel(league, lead, a)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MessageHead({
  league,
  m,
  from,
  subject,
  needs,
  index,
  folded = false,
}: {
  league: League;
  m: InboxMessage;
  from: string;
  subject: string;
  needs: boolean;
  index: MoveIndex;
  folded?: boolean;
}) {
  const nav = useNav();
  const who = sender(from);
  return (
    <header className="inbox-head">
      <span className={`mail-av mail-av-lg cat-${m.category}`} aria-hidden="true">
        {who.initials}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="small">
          {m.fromCard ? (
            <button
              className="linklike"
              style={{ fontWeight: 700 }}
              onClick={() => nav.openStaff(m.fromCard!.kind, m.fromCard!.id)}
            >
              {who.name}
            </button>
          ) : folded ? (
            <b>{who.name}</b>
          ) : (
            // An agent writes for his client, a retiring player for himself: either name opens the player.
            <b>
              <LinkedText league={league} text={who.name} about={aboutOf(m)} index={index} />
            </b>
          )}
          <span className="muted">
            {who.role && ` · ${who.role}`} · {dateLabel(m)}
          </span>
        </div>
        <h3>{folded ? subject : <LinkedText league={league} text={subject} about={aboutOf(m)} index={index} />}</h3>
      </div>
      <span className="inbox-tags">
        <span className={`mail-tag cat-${m.category}`}>{tagOf(m)}</span>
        {needs && <span className="needs-pill">Needs you</span>}
      </span>
    </header>
  );
}
