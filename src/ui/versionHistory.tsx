import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CHANGELOG, type ChangelogEntry } from './changelog';
import { Dialog } from './components';
import { APP_VERSION } from './version';

const day = (iso: string, year = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  });

/** One line of versions (every 0.4.x), newest update first. */
export interface VersionLine {
  line: string;
  entries: ChangelogEntry[];
}

/** The history by line: the updates that share a middle number fold under it, newest line first. */
export function versionLines(log: readonly ChangelogEntry[]): VersionLine[] {
  const out: VersionLine[] = [];
  for (const e of log) {
    const line = e.version.split('.').slice(0, 2).join('.');
    if (out.at(-1)?.line === line) out.at(-1)!.entries.push(e);
    else out.push({ line, entries: [e] });
  }
  return out;
}

/** When a line's updates landed: one day, or its first to its last. */
function span(entries: ChangelogEntry[]): string {
  const [last, first] = [entries[0].date, entries.at(-1)!.date];
  return first === last ? day(last, true) : `${day(first)} to ${day(last, true)}`;
}

/**
 * The version tag, shown on every screen; it opens the version history: one fold per line of versions (0.4, 0.3…),
 * the newest open with every update in it listed, the older ones a click away.
 */
export function VersionTag({ className = 'app-version' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${className} version-tag`} onClick={() => setOpen(true)} title="Version history">
        {APP_VERSION}
      </button>
      {/* On the body, so the history doesn't take on the styling of wherever the tag sits (New Game's eyebrow). */}
      {open &&
        createPortal(
          <Dialog title="Version history" onClose={() => setOpen(false)}>
            <div className="changelog">
              {versionLines(CHANGELOG).map((l, i) => (
                <details key={l.line} open={i === 0}>
                  {/* tabIndex lets the dialog's Tab loop find each line. */}
                  <summary tabIndex={0}>
                    <strong>v{l.line}</strong>{' '}
                    <span className="muted">
                      · {l.entries.length} {l.entries.length === 1 ? 'update' : 'updates'} · {span(l.entries)}
                    </span>
                  </summary>
                  <ul className="changelog-list">
                    {l.entries.map((e) => (
                      <li key={e.version}>
                        <div>
                          <strong>{e.title}</strong>{' '}
                          <span className="muted small">
                            v{e.version} · {day(e.date)}
                          </span>
                        </div>
                        <p>{e.text}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
