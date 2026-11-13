import type { JSX, ReactNode } from 'react';

/**
 * The game's icons: one set, drawn here on a 24-unit grid, instead of characters like ▶ or ✕ that every font (and
 * iOS's emoji) draws its own way. Each is sized `1em`, so it follows the text around it, and painted in
 * `currentColor`, so it follows the theme. `docs/UI.md`, "Icons".
 */
export const ICON_NAMES = [
  'close',
  'back',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'chevron-up',
  'caret-up',
  'caret-down',
  'play',
  'pause',
  'rewind',
  'forward',
  'edit',
  'check',
  'trend-up',
  'trend-down',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Line icons: a 2-unit stroke with round ends. */
const LINES: Partial<Record<IconName, ReactNode>> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  'chevron-left': <polyline points="15 5 8 12 15 19" />,
  'chevron-right': <polyline points="9 5 16 12 9 19" />,
  'chevron-down': <polyline points="5 9 12 16 19 9" />,
  'chevron-up': <polyline points="5 15 12 8 19 15" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />,
  check: <polyline points="4 12.5 9.5 18 20 6" />,
  'trend-up': <path d="M5 17L17 5M9 5h8v8" />,
  'trend-down': <path d="M5 7l12 12M17 11v8H9" />,
};

/** Solid icons: the carets and the playback controls. */
const SOLIDS: Partial<Record<IconName, ReactNode>> = {
  'caret-up': <polygon points="12 6 20 17 4 17" />,
  'caret-down': <polygon points="4 7 20 7 12 18" />,
  play: <polygon points="7 4 20 12 7 20" />,
  pause: <path d="M6 4h4v16H6zM14 4h4v16h-4z" />,
  rewind: <path d="M11 5v14L3 12zM21 5v14l-8-7z" />,
  forward: <path d="M13 5v14l8-7zM3 5v14l8-7z" />,
};

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }): JSX.Element {
  const solid = name in SOLIDS;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false };
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={`icon${className ? ` ${className}` : ''}`}
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {solid ? SOLIDS[name] : LINES[name]}
    </svg>
  );
}
