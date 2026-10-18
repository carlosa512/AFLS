import { useState } from 'react';
import type { InboxAction, InboxCategory, InboxMessage, League } from '../../engine/types';
import { useNav } from '../App';
import { Panel } from '../components';
import { PHASE_LABELS, weekLabel } from '../format';
import { store } from '../store';

const FILTERS: [InboxCategory | 'all', string][] = [
  ['all', 'All'],
  ['awards', 'Awards'],
  ['contracts', 'Contracts'],
  ['retirement', 'Retirement'],
  ['scouting', 'Scouting'],
  ['matchup', 'Matchups'],
  ['trades', 'Trades'],
];

const ACTION_LABEL: Record<InboxAction['kind'], string> = { player: 'View player', resign: 'Expiring contracts', draft: 'Draft room', trades: 'Trades' };

const dateLabel = (m: InboxMessage) => `${m.season} · ${m.phase === 'regular' || m.phase === 'playoffs' ? weekLabel(m.week) : PHASE_LABELS[m.phase]}`;

/** Mail from the league office, agents and your own staff, newest first. */
export function Inbox({ league }: { league: League }) {
  const nav = useNav();
  const [filter, setFilter] = useState<InboxCategory | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const messages = (league.inbox ?? []).filter((m) => filter === 'all' || m.category === filter).reverse();
  const open = league.inbox?.find((m) => m.id === openId);

  const read = (m: InboxMessage) => {
    setOpenId(m.id);
    if (!m.read) store.mutate((l) => void (l.inbox!.find((x) => x.id === m.id)!.read = true));
  };
  const act = (a: InboxAction) => {
    if (a.kind === 'player') nav.openPlayer(a.playerId);
    else nav.go({ view: 'office', tab: a.kind });
  };

  return (
    <Panel
      title="Inbox"
      className="inbox"
      action={
        <div className="seg seg-sm" role="group" aria-label="Show messages">
          {FILTERS.map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="inbox-panes">
        <ul className="inbox-list" aria-label="Messages">
          {messages.length === 0 && <li className="muted">Nothing here yet.</li>}
          {messages.map((m) => (
            <li key={m.id}>
              <button className={`inbox-row${m.read ? '' : ' is-unread'}`} aria-current={m.id === openId ? 'true' : undefined} onClick={() => read(m)}>
                <span className="eyebrow">
                  {m.from} · {dateLabel(m)}
                </span>
                <span>{m.subject}</span>
              </button>
            </li>
          ))}
        </ul>
        <article className="inbox-message" aria-live="polite">
          {open ? (
            <>
              <span className="eyebrow">
                {open.from} · {dateLabel(open)}
              </span>
              <h3>{open.subject}</h3>
              <p>{open.body}</p>
              {open.action && (
                <button className="btn btn-sm btn-primary" onClick={() => act(open.action!)}>
                  {ACTION_LABEL[open.action.kind]}
                </button>
              )}
            </>
          ) : (
            <p className="muted">Pick a message to read it.</p>
          )}
        </article>
      </div>
    </Panel>
  );
}
