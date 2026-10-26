import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CHANGELOG } from './changelog';
import { Dialog } from './components';
import { APP_VERSION } from './version';

const dateText = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** The version tag, shown on every screen; it opens the version history, one folded entry a version (the newest open). */
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
              {CHANGELOG.map((e, i) => (
                <details key={e.version} open={i === 0}>
                  {/* tabIndex lets the dialog's Tab loop find each entry. */}
                  <summary tabIndex={0}>
                    <strong>v{e.version}</strong> <span className="muted">· {dateText(e.date)} ·</span> {e.title}
                  </summary>
                  <p>{e.text}</p>
                </details>
              ))}
            </div>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
