# Versioning

AFLS versions are `MAJOR.MINOR.PATCH`, set in `package.json` and shown on the main menu.

- **Middle number (MINOR):** bump it when an MVP item in `docs/MVP.md` goes to Done, and reset PATCH to 0.
  Example: `0.1.3` → `0.2.0`.
- **Last number (PATCH):** bump it for fixes and anything else that doesn't finish an MVP item. Example: `0.2.0` → `0.2.1`.
- **Every bump adds an entry** to `src/ui/changelog.ts` (newest first): a title (40 characters at most) and one or
  two short sentences (200 characters at most), in a player's words, about what the version did. Fun or to the
  point, never a paragraph; a test holds the limits. Players read it from the version tag on any screen: the
  newest line of versions (every `0.4.x`) is open with its updates listed, older lines are folded.
- **Alpha** is reached when every MVP item is Done.
- **1.0.0** is release.

The count started at `0.1.0` on 2026-10-20. Items already Done on that day don't count, so the middle number tracks
MVP items finished from then on, not the total.

`SAVE_VERSION` in `src/engine/generate.ts` is separate: it tracks the save format, not the game.
