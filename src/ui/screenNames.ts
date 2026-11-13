/**
 * Each screen's name, in a file of its own with no imports: the app shell reads it while building its tabs, and
 * `routes.ts` (which reaches the screens, which reach the shell) re-exports it.
 */
export type View =
  | 'home'
  | 'roster'
  | 'cap'
  | 'inbox'
  | 'office'
  | 'schedule'
  | 'locker'
  | 'standings'
  | 'stats'
  | 'playoffs'
  | 'compare'
  | 'game'
  | 'watch'
  | 'live';

/** Each screen's name: the top bar's labels, and the hidden h1 the app writes for a screen reader. */
export const SCREEN_NAMES: Record<View, string> = {
  home: 'Home',
  roster: 'Roster',
  cap: 'Cap',
  locker: 'Locker Room',
  inbox: 'Inbox',
  office: 'Front office',
  schedule: 'Schedule',
  standings: 'Standings',
  stats: 'Stats',
  playoffs: 'Playoffs',
  compare: 'Compare players',
  game: 'Box score',
  watch: 'Replay',
  live: 'Live game',
};
