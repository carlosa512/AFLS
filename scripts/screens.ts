/**
 * Screenshots of the real app with a save loaded, for previews after a change.
 *
 *   npm run screens -- --save <save.json> --out <dir> [--team <abbrev>] [--dark]
 *
 * Starts the Vite dev server on a free port, opens it in headless Chromium, writes the save into the
 * same IndexedDB slot the app autosaves to (`afls` / `saves` / `career`, see `ui/store.ts`), reloads so
 * the app loads and migrates it exactly as a returning player's would, and walks the screens. Every
 * screen is a full-page PNG at 1440x900, plus a 390x844 phone shot of Home and a GM card. A user who
 * is between GM jobs gets the spectator screens the nav offers instead of the team ones.
 *
 *   --team  the club whose Roster (and, when you have a job, Cap) screen is shown; default: yours.
 *   --dark  the dark theme instead of the light one.
 *   --screens  only these, desktop and phone each: a comma list of `roster`, `locker` (the Locker Room) and `card`
 *              (your roster's first player's card).
 *   --mail  only letters: a comma list of message-id prefixes (`locker:,waivers:`); for each, the newest message
 *           whose id starts with it is opened in the inbox and shot on desktop and phone.
 *   --film  only All-22 recordings: a comma list of play kinds (`fumble`, `sack`, `pressure`, `deep`, `screen`, `int`, `kneel`, `long`, `move`, `return`,
 *           `throwaway`); for each, the first such play in the save's kept games is opened in *Watch replay* in
 *           All-22 and recorded as `<kind>-desktop.webm` and `<kind>-phone.webm`.
 *
 * Playwright and Chromium are not project dependencies: they come from the machine (a global install,
 * found through NODE_PATH, or a local one). The server and the browser are closed when the run ends.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { renameSync } from 'node:fs';
import { createServer } from 'vite';
import { actorsIn } from '../src/engine/playActors';
import type { PlayLogEntry } from '../src/engine/types';
import { fumbleIn } from '../src/engine/field/fumble';

// ───────── the slice of Playwright's API this script uses (it isn't a project dependency, so no types) ─────────

interface Locator {
  first(): Locator;
  click(options?: { timeout?: number }): Promise<void>;
  waitFor(options?: { state?: 'visible' | 'attached'; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  textContent(): Promise<string | null>;
  screenshot(options: { path: string }): Promise<unknown>;
}
interface Page {
  goto(url: string, options?: { waitUntil?: 'load' | 'networkidle' }): Promise<unknown>;
  reload(options?: { waitUntil?: 'load' | 'networkidle' }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  locator(selector: string): Locator;
  waitForLoadState(state: 'networkidle', options?: { timeout?: number }): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  keyboard: { press(key: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  video(): { path(): Promise<string> } | null;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  on(event: 'console', handler: (msg: { type(): string; text(): string }) => void): void;
}
interface Context {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  addInitScript<A>(fn: (arg: A) => void, arg: A): Promise<void>;
}
interface Browser {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    colorScheme?: 'light' | 'dark';
    recordVideo?: { dir: string; size: { width: number; height: number } };
  }): Promise<Context>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(): Promise<Browser> };
}

// ───────── options ─────────

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const savePath = option('save');
const outOption = option('out');
const teamAbbrev = option('team');
const theme = flag('dark') ? 'dark' : 'light';
const mailPrefixes = option('mail')
  ?.split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const filmKinds = option('film')
  ?.split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const onlyScreens = option('screens')
  ?.split(',')
  .map((x) => x.trim())
  .filter(Boolean);
if (!savePath || !outOption) {
  console.error('Usage: npm run screens -- --save <save.json> --out <dir> [--team <abbrev>] [--dark]');
  process.exit(2);
}
const outDir = resolve(outOption);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** A page or card taller than this is cut off (a very long one would make a PNG too large to send). */
const MAX_CARD_HEIGHT = 8000;

function loadPlaywright(): Playwright {
  // createRequire, not import: a global install is found through NODE_PATH, which ES imports ignore.
  try {
    return createRequire(import.meta.url)('playwright') as Playwright;
  } catch {
    console.error('Playwright is not installed here. Install it (npm i -g playwright) and its Chromium, then retry.');
    process.exit(2);
  }
}

// ───────── the page ─────────

/** Waits until nothing is loading and the next two frames have painted, instead of sleeping. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(async () => {
    // Web fonts come from a CDN; offline they never arrive, so don't wait on them for long.
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** Puts the save in the app's IndexedDB slot (the string `ui/store.ts` reads), then reloads so the app loads it. */
async function loadSaveIntoApp(page: Page, url: string, raw: string) {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate((json: string) => {
    return new Promise<void>((done, fail) => {
      const open = indexedDB.open('afls', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('saves');
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(json, 'career');
        tx.oncomplete = () => {
          db.close();
          done();
        };
        tx.onerror = () => fail(tx.error);
      };
    });
  }, raw);
  await page.reload({ waitUntil: 'load' });
  // The top bar only exists once a league is loaded (without one the app shows New Game).
  await page.locator('header.topbar').first().waitFor({ state: 'visible', timeout: 60_000 });
  await settle(page);
}

/** Opens a screen by its address, as a click on its tab would; the app follows the hash. */
async function goTo(page: Page, hash: string, ready: string) {
  await page.evaluate((h: string) => {
    location.hash = h;
  }, hash);
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 30_000 });
  await settle(page);
}

/** Opens a player-sheet-style card over the screen and sizes the window to fit it, so one shot shows all of it. */
async function shootCard(page: Page, viewport: { width: number; height: number }, path: string) {
  await page.locator('[role="dialog"].sheet').first().waitFor({ state: 'visible', timeout: 15_000 });
  await settle(page);
  const height = await page.evaluate(() => {
    const overlay = document.querySelector('.overlay');
    return overlay ? overlay.scrollHeight : 0;
  });
  await page.setViewportSize({
    width: viewport.width,
    height: Math.min(Math.max(viewport.height, height), MAX_CARD_HEIGHT),
  });
  await settle(page);
  await page.screenshot({ path });
  await page.setViewportSize(viewport);
  await settle(page);
}

/**
 * A full-page shot with the window grown to the page's height, not Playwright's `fullPage`: a fixed bar
 * (the phone's action buttons) then sits at the bottom of the page, where a player sees it, instead of
 * floating mid-way down the picture.
 */
async function shootPage(page: Page, viewport: { width: number; height: number }, path: string) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({
    width: viewport.width,
    height: Math.min(Math.max(viewport.height, height), MAX_CARD_HEIGHT),
  });
  await settle(page);
  await page.screenshot({ path, fullPage: true });
  await page.setViewportSize(viewport);
  await settle(page);
}

async function closeCard(page: Page) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ───────── All-22 recordings ─────────

/** What each `--film` kind looks for in a kept game's plays (a lost fumble with a return first, if there is one). */
const FILM: Record<string, (e: PlayLogEntry) => number> = {
  fumble: (e) => {
    const f = fumbleIn(e);
    return !f ? 0 : f.lost && e.loose !== undefined && Math.abs((e.to ?? 0) - e.loose) > 3 ? 2 : 1;
  },
  sack: (e) => (e.kind === 'sack' ? (fumbleIn(e) ? 2 : 1) : 0),
  pressure: (e) => (e.kind === 'pass' && actorsIn(e).rush !== undefined ? 1 : 0),
  deep: (e) => (e.kind === 'pass' && e.air !== undefined && Math.abs(e.air - (e.from ?? 0)) >= 20 ? 1 : 0),
  screen: (e) =>
    e.kind === 'pass' &&
    e.air !== undefined &&
    (e.air - (e.from ?? 0)) * Math.sign((e.to ?? 0) - (e.from ?? 0) || 1) < 0
      ? 1
      : 0,
  int: (e) => (e.kind === 'int' ? 1 : 0),
  throwaway: (e) => (/throws it away/.test(e.text) ? 1 : 0),
  kneel: (e) => (e.kind === 'kneel' && /kneels\./.test(e.text) ? 1 : 0),
  long: (e) => (e.kind === 'run' && !/TOUCHDOWN/.test(e.text) && Math.abs((e.to ?? 0) - (e.from ?? 0)) >= 20 ? 1 : 0),
  // A run the engine says broke a tackle (a longer one first: more of the move and the man carrying on past).
  move: (e) => (e.kind === 'run' && e.open?.broke ? 1 + Math.min(1, Math.abs((e.to ?? 0) - (e.from ?? 0)) / 20) : 0),
  // A kickoff run back 30 yards and more, not to the house: the wall, maybe a miss, and the pile.
  return: (e) =>
    e.kind === 'kickoff' &&
    !/TOUCHDOWN|PENALTY/.test(e.text) &&
    e.air !== undefined &&
    Math.abs((e.to ?? 0) - e.air) >= 30
      ? 1
      : 0,
};
/** Kinds that aren't snapped from scrimmage (no down). */
const UNDOWNED: ReadonlySet<string> = new Set(['return']);
/** Long enough for the line-up, the moments at the line, the play and its hold. */
const CLIP_MS = 12_000;

// ───────── run ─────────

async function main() {
  const raw = readFileSync(resolve(savePath!), 'utf8');
  const save = JSON.parse(raw) as {
    userTeamId: number;
    teams: { id: number; abbrev: string }[];
    inbox?: { id: string; deleted?: boolean; organizationId?: number }[];
  };
  const shownTeam = teamAbbrev
    ? save.teams.find((t) => t.abbrev.toLowerCase() === teamAbbrev.toLowerCase())
    : save.teams[save.userTeamId];
  if (!shownTeam) {
    console.error(`No team "${teamAbbrev}" in that save. Teams: ${save.teams.map((t) => t.abbrev).join(' ')}`);
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();

  const server = await createServer({
    // A free port, so a dev server already running doesn't matter; nothing is written outside .vite caches.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    logLevel: 'error',
    clearScreen: false,
  });
  await server.listen();
  const { port } = server.httpServer!.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch();
  const written: string[] = [];
  const problems: string[] = [];
  let n = 0;
  const file = (name: string) => {
    const path = join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`);
    written.push(path);
    return path;
  };

  const newPage = async (viewport: { width: number; height: number }, phone: boolean) => {
    const context = await browser.newContext({
      viewport,
      colorScheme: theme,
      ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
    });
    // index.html reads this before the first paint, so the chosen theme never flashes.
    await context.addInitScript((t: string) => localStorage.setItem('afls-theme', t), theme);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) problems.push(m.text());
    });
    await loadSaveIntoApp(page, url, raw);
    return page;
  };

  /** One play in All-22, in a context of its own so the recording holds that play alone. */
  const film = async (kind: string, gameId: number, index: number, viewport: typeof DESKTOP, phone: boolean) => {
    const dir = join(outDir, '.video');
    const context = await browser.newContext({
      viewport,
      colorScheme: theme,
      recordVideo: { dir, size: viewport },
      ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
    });
    await context.addInitScript((t: string) => {
      localStorage.setItem('afls-theme', t);
      localStorage.setItem('afls-viewer-view', 'all22');
    }, theme);
    // The save goes in from a first page; the recording is the second's, which opens straight on the replay.
    const loader = await context.newPage();
    await loadSaveIntoApp(loader, url, raw);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    await page.goto(`${url}#/watch/${gameId}`, { waitUntil: 'load' });
    await page.locator('#viewer-scrub').first().waitFor({ state: 'visible', timeout: 30_000 });
    await settle(page);
    // The scrubber is a React range input: set its value the way a drag would, so the play animates from its snap.
    await page.evaluate((i: number) => {
      const el = document.getElementById('viewer-scrub') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(i));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, index);
    await page.waitForTimeout(CLIP_MS);
    const video = page.video();
    await context.close();
    if (!video) return;
    const path = join(outDir, `${kind}-${phone ? 'phone' : 'desktop'}.webm`);
    renameSync(await video.path(), path);
    written.push(path);
  };

  try {
    if (filmKinds) {
      const games = (
        save as unknown as { games: { id: number; result?: { plays?: PlayLogEntry[]; field?: unknown } }[] }
      ).games.filter((g) => g.result?.plays && g.result.field);
      for (const kind of filmKinds) {
        const score = FILM[kind];
        if (!score) {
          console.warn(`No film kind "${kind}": ${Object.keys(FILM).join(', ')}`);
          continue;
        }
        let best: { gameId: number; index: number; s: number } | null = null;
        for (const g of games)
          g.result!.plays!.forEach((e, index) => {
            // Between the 25s where it can: a play squeezed against a goal line shows less.
            const s =
              (e.down > 0 || UNDOWNED.has(kind)) && score(e) > 0
                ? score(e) + (e.yardLine >= 25 && e.yardLine <= 75 ? 0.5 : 0)
                : 0;
            if (s > (best?.s ?? 0)) best = { gameId: g.id, index, s };
          });
        if (!best) {
          console.warn(`No ${kind} play in the save's kept games`);
          continue;
        }
        const { gameId, index } = best;
        await film(kind, gameId, index, DESKTOP, false);
        await film(kind, gameId, index, PHONE, true);
      }
    } else if (mailPrefixes) {
      const page = await newPage(DESKTOP, false);
      const phone = await newPage(PHONE, true);
      // Mail the GM can read now: not deleted, and his own club's (a former club's letters stay with it).
      const inbox = (save.inbox ?? []).filter(
        (m) => !m.deleted && (m.organizationId === undefined || m.organizationId === save.userTeamId),
      );
      for (const prefix of mailPrefixes) {
        const m = [...inbox].reverse().find((x) => x.id.startsWith(prefix));
        if (!m) {
          console.warn(`No message starts with "${prefix}"`);
          continue;
        }
        const slug = prefix.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
        const hash = `#/inbox/${encodeURIComponent(m.id)}`;
        await goTo(page, '#/', 'main');
        await goTo(page, hash, 'main article');
        // The letter alone: the inbox list beside it runs to thousands of pixels.
        await page
          .locator('main article')
          .first()
          .screenshot({ path: file(`mail-${slug}`) });
        // The inbox opens a message as it mounts: go Home first, or the phone stays on the last one.
        await goTo(phone, '#/', 'main');
        await goTo(phone, hash, 'main article');
        await shootPage(phone, PHONE, file(`mail-${slug}-phone`));
      }
    } else if (onlyScreens) {
      const page = await newPage(DESKTOP, false);
      const phone = await newPage(PHONE, true);
      for (const name of onlyScreens)
        for (const [p, viewport, suffix] of [
          [page, DESKTOP, ''],
          [phone, PHONE, '-phone'],
        ] as const) {
          if (name === 'roster' || name === 'card') {
            await goTo(p, `#/roster/${save.userTeamId}`, 'main table, main .panel');
            if (name === 'roster') await shootPage(p, viewport, file(`roster${suffix}`));
            else {
              await p.locator('main table tbody tr.depth-row button.linklike').first().click();
              await shootCard(p, viewport, file(`card${suffix}`));
              await closeCard(p);
            }
          } else if (name === 'locker') {
            await goTo(p, '#/locker', 'main h1');
            await shootPage(p, viewport, file(`locker${suffix}`));
          } else console.warn(`No screen called "${name}" (roster, locker, card)`);
        }
    } else {
      const page = await newPage(DESKTOP, false);
      // Between GM jobs: the top bar says so, and the team screens give way to spectator ones.
      const brand = (await page.locator('.brand-text strong').first().textContent()) ?? '';
      const employed = !/Between GM jobs/i.test(brand);
      const shoot = (name: string) => shootPage(page, DESKTOP, file(name));
      const team = shownTeam.id;

      await goTo(page, '#/', 'main h2, main h1, main .panel');
      await shoot('home');

      await goTo(page, '#/office/gms', '.gm-directory-table');
      await shoot('gm-directory');

      // A GM other than you, from the directory.
      await page.locator('.gm-directory-table tbody tr:not(.is-user) button.linklike').first().click();
      await shootCard(page, DESKTOP, file('gm-card'));
      await closeCard(page);

      // Your own GM card, from the career overview.
      await page.locator('.gm-career-overview button.linklike').first().click();
      await shootCard(page, DESKTOP, file('your-gm-card'));
      await closeCard(page);

      await goTo(page, '#/inbox', 'main');
      await shoot('inbox');

      if (employed) {
        await goTo(page, '#/office/coaches', 'main');
        await shoot('coaches');
      }

      await goTo(page, `#/roster/${team}`, 'main table, main .panel');
      await shoot(employed && team === save.userTeamId ? 'roster' : `roster-${shownTeam.abbrev.toLowerCase()}`);

      if (employed) {
        await goTo(page, `#/cap/${team}`, 'main .panel');
        await shoot(team === save.userTeamId ? 'cap' : `cap-${shownTeam.abbrev.toLowerCase()}`);
      }

      await goTo(page, '#/standings', 'main table');
      await shoot('standings');

      // Phone: Home and a GM card.
      const phone = await newPage(PHONE, true);
      await goTo(phone, '#/', 'main h2, main h1, main .panel');
      await shootPage(phone, PHONE, file('phone-home'));
      await goTo(phone, '#/office/gms', '.gm-directory-table');
      await phone.locator('.gm-directory-table tbody tr:not(.is-user) button.linklike').first().click();
      await shootCard(phone, PHONE, file('phone-gm-card'));

      // The dev server's error overlay means a screen failed to compile; a PNG of it is not a preview.
      for (const p of [page, phone]) {
        if ((await p.locator('vite-error-overlay').count()) > 0) problems.push('Vite error overlay on a screen');
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  console.log(`\n${written.length} screenshots (${theme} theme):`);
  for (const p of written) console.log(`  ${p}`);
  if (problems.length) {
    console.log(`\nApp errors seen (${problems.length}):`);
    for (const p of [...new Set(problems)].slice(0, 10)) console.log(`  ${p.slice(0, 300)}`);
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
