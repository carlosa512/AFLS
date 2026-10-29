/**
 * One command for every engine check. It picks the checks a change needs (see RULES), runs them side
 * by side, prints one line each and exits non-zero if any fails. CI runs the same plan, one job per
 * check, so local runs and pull requests agree.
 *
 *   npm run check                  # what changed vs origin/main: commits, edits and new files
 *   npm run check -- --quick       # same, minus the slow ones (careers, audit): CI still runs them
 *   npm run check -- --all         # every check
 *   npm run check -- sim careers   # just these
 *   npm run check -- --base HEAD~3 # changes since another ref
 *
 * CI calls `node scripts/check.ts --plan` for the plan as JSON (through npm, the banner would get in
 * the way). Full logs go to .check/<name>.log; a failure prints the lines that flagged it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

interface Check {
  cmd: string[];
  /** CPU cores it keeps busy, so a local run doesn't oversubscribe the machine. */
  cores: number;
  /** Rough wall time on 4 cores: the longest start first. */
  secs: number;
  /** Too slow for `--quick`. */
  slow?: boolean;
  /** The line that sums the run up (the last match wins). */
  summary?: RegExp;
  /** Lines worth showing when it fails; without it, the flagged lines or the end of the log. */
  detail?: RegExp;
}

const CORES = availableParallelism();

const CHECKS = {
  // Prettier, with the repo's .prettierrc.json; `npm run format` fixes what it flags.
  format: {
    cmd: ['npm', 'run', 'format:check'],
    cores: 1,
    secs: 10,
    summary: /Code style issues found.*|All matched files use Prettier code style.*/,
    detail: /\[warn\]/,
  },
  typecheck: { cmd: ['npm', 'run', 'typecheck'], cores: 1, secs: 10, summary: /error TS\d+.*/ },
  test: { cmd: ['npm', 'test'], cores: CORES, secs: 55, summary: /Tests\s+.*/, detail: /FAIL|Error|Expected|Received/ },
  build: { cmd: ['npx', 'vite', 'build', '--logLevel', 'error'], cores: 1, secs: 15 },
  sim: { cmd: ['npm', 'run', 'sim', '--', '30'], cores: 1, secs: 110, summary: /\d+ stat\(s\) outside target range/ },
  endings: {
    cmd: ['npm', 'run', 'endings', '--', '5000'],
    cores: 1,
    secs: 10,
    summary: /\d+ flagged ending\(s\)/,
    detail: /^\S.*: \d+$/,
  },
  // One league judged season by season, and three more in child processes for the cap-space drift.
  offseason: {
    cmd: ['npm', 'run', 'offseason', '--', '6'],
    cores: 4,
    secs: 35,
    summary: /\d+ number\(s\) outside target range/,
  },
  // Four leagues in child processes plus the cohort curves in the parent.
  careers: {
    cmd: ['npm', 'run', 'careers'],
    cores: 4,
    secs: 180,
    slow: true,
    summary: /\d+ number\(s\) outside target range/,
  },
  audit: {
    cmd: ['npm', 'run', 'audit'],
    cores: 1,
    secs: 170,
    slow: true,
    summary: /Needs attention.*|Every attribute.*/,
  },
  // The marble bag's churn and every quirk's effect, replayed on the same games.
  quirks: {
    cmd: ['npm', 'run', 'quirks', '--', '--effects'],
    cores: 1,
    secs: 290,
    slow: true,
    summary: /Needs attention.*|Every quirk.*|▼ Nobody carries.*/,
    detail: /^[▲▼]|NO EFFECT|WRONG WAY/,
  },
  // League weather, forecast calibration, and each condition's effect replayed on the same games.
  weather: {
    cmd: ['npm', 'run', 'weather'],
    cores: 1,
    secs: 25,
    summary: /\d+ number\(s\) outside target range/,
    detail: /[▲▼✗]/,
  },
  // Player size: the curves, the rare gem, the edges' cap, each lever replayed on the same games, totals centred.
  size: {
    cmd: ['npm', 'run', 'size'],
    cores: 1,
    secs: 420,
    summary: /\d+ number\(s\) outside target range/,
    detail: /✗/,
  },
  // Officiating crews: the league stays at baseline, the crews spread like the NFL's, the rotation and drift hold.
  crews: {
    cmd: ['npm', 'run', 'crews'],
    cores: 1,
    secs: 15,
    summary: /\d+ number\(s\) outside target range/,
    detail: /[▲▼]/,
  },
  // The trade market: prices against the NFL's, fair and legal AI trades, the exploit probes, speed. More leagues are
  // priced in child processes on the other cores.
  trades: {
    cmd: ['npm', 'run', 'trades'],
    cores: 4,
    secs: 110,
    summary: /\d+ number\(s\) outside target range/,
    detail: /[▲▼✗]/,
  },
  // Training: position moves' invariants and development released in steps (docs/TRAINING.md §12).
  training: {
    cmd: ['npm', 'run', 'training'],
    cores: 1,
    secs: 60,
    summary: /\d+ number\(s\) outside target range/,
    detail: /[▲▼✗]/,
  },
  squads: {
    cmd: ['npm', 'run', 'squads', '--', '2'],
    cores: 1,
    secs: 60,
    summary: /\d+ squad invariant failures/,
  },
  waivers: {
    cmd: ['npm', 'run', 'waivers', '--', '2'],
    cores: 1,
    secs: 40,
    summary: /\d+ personnel invariant failures/,
  },
  // Practice squad poaching: legal every week, and how often it happens (docs/PRACTICE_SQUADS.md).
  poaching: {
    cmd: ['npm', 'run', 'poaching', '--', '2'],
    cores: 1,
    secs: 180,
    summary: /\d+ poaching number\(s\) outside target range/,
    detail: /✗/,
  },
  // Morale: the league's moods by band, underpaid starters, a benching's dip and recovery, winning rooms, no drift.
  morale: {
    cmd: ['npm', 'run', 'morale'],
    cores: 1,
    secs: 80,
    summary: /\d+ number\(s\) outside target range/,
    detail: /✗/,
  },
} satisfies Record<string, Check>;

type Name = keyof typeof CHECKS;
const NAMES = Object.keys(CHECKS) as Name[];

/**
 * Which checks a changed file calls for; a file collects every rule it matches. CLAUDE.md's
 * per-command "run it after" lists are the minimum. Any engine file runs every league check, since
 * leagues reach nearly all of it and a module touches more than its folder suggests (a schemes change
 * once broke the career audit's passing records with nobody the wiser). `audit` skips only the files
 * its own code can't import, because anything that builds its league or decides play moves the
 * numbers in docs/ATTRIBUTES.md. Deliberately not covered: `build:single` (scripts/artifact.mjs).
 */
const RULES: [RegExp, Name[]][] = [
  [
    /^src\/engine\/(personnel\/|roster\.ts|finance\/|offseason\/|league\.ts|trade\/|injuries\.ts)|^scripts\/(waivers|squads|poaching)\.ts$/,
    ['waivers', 'squads', 'poaching'],
  ],
  // Every change is formatted, whatever it touches (Prettier skips what .prettierignore lists).
  [/./, ['format']],
  [/^src\/.*\.test\.ts$/, ['typecheck', 'test']],
  [/^src\/engine\/(?!.*\.test\.ts$|migrate\.ts$)/, ['typecheck', 'test', 'sim', 'endings', 'offseason', 'careers']],
  [
    /^src\/engine\/(?!.*\.test\.ts$|migrate\.ts$|awards\.ts$|league\.ts$|records\.ts$|stats\.ts$|trade\/|offseason\/|season\/(playoffs|standings)\.ts$)/,
    ['audit'],
  ],
  // Saves: only the UI and the tests load it.
  [/^src\/engine\/migrate\.ts$/, ['typecheck', 'test']],
  // The UI has tests too (src/ui/ui.test.ts), and vite.config.ts is also vitest's config.
  [/^src\/(?!engine\/)|^index\.html$|^vite\.config\.ts$/, ['typecheck', 'test', 'build']],
  // tsconfig covers scripts/ too, and tsx runs them without checking types.
  [/^scripts\/.*\.ts$/, ['typecheck']],
  [/^scripts\/calibrate\.ts$/, ['sim']],
  [/^scripts\/leaders\.ts$/, ['sim', 'careers']],
  [/^scripts\/endings\.ts$/, ['endings']],
  [/^scripts\/offseason(-league)?\.ts$/, ['offseason']],
  [/^scripts\/careers(-league)?\.ts$/, ['careers']],
  [/^scripts\/audit\.ts$|^docs\/ATTRIBUTES\.md$/, ['audit']],
  // Quirks: the bag and its hooks, and what builds the leagues they're measured in.
  [/^src\/engine\/(?!.*\.test\.ts$)(quirks|match\/|generate|coaching|schemes|attributes|positions|traits)/, ['quirks']],
  [/^scripts\/quirks\.ts$/, ['quirks']],
  // Weather: the rolls and their effects, and what builds the leagues and schedules they're measured in.
  [/^src\/engine\/(?!.*\.test\.ts$)(weather|data\/stadiums|match\/|generate|season\/schedule)/, ['weather']],
  [/^scripts\/weather\.ts$/, ['weather']],
  // Size: the curves and edges, the gem, and what builds the leagues and plays the games they're measured in.
  [/^src\/engine\/(?!.*\.test\.ts$)(size|match\/|generate)/, ['size']],
  [/^scripts\/size\.ts$/, ['size']],
  // Crews: their tendencies and rotation, the penalty rolls they multiply, and what builds the leagues and schedules.
  [/^src\/engine\/(?!.*\.test\.ts$)(officials|match\/|generate|season\/schedule|offseason\/index)/, ['crews']],
  [/^scripts\/crews\.ts$/, ['crews']],
  // Trades: the market and what it values players with (scouting reads, contracts, the cap, rosters, aging, coaches).
  [
    /^src\/engine\/(?!.*\.test\.ts$)(trade\/|offseason\/|finance\/|coaching|scouting|staff|aging|positions|roster|league\.ts|generate)/,
    ['trades'],
  ],
  [/^scripts\/trades(-prices)?\.ts$/, ['trades']],
  // Training: the moves, the learning clock, development's roll and release, and the calendar steps that run them.
  [
    /^src\/engine\/(?!.*\.test\.ts$)(training|familiarity|development|aging|traits|quirks|offseason\/|league\.ts|generate)/,
    ['training'],
  ],
  [/^scripts\/training\.ts$/, ['training']],
  // Morale: the moods and the league check that holds them to range.
  [/^src\/engine\/morale\.ts$|^scripts\/morale\.ts$/, ['morale']],
  // The harness itself, dependencies and compiler settings can break anything.
  [/^scripts\/check\.ts$|^package(-lock)?\.json$|^tsconfig\.json$|^\.github\/workflows\//, NAMES],
];

function plan(files: string[]): Name[] {
  const want = new Set<Name>();
  for (const f of files) for (const [re, names] of RULES) if (re.test(f)) names.forEach((n) => want.add(n));
  return NAMES.filter((n) => want.has(n));
}

const git = (...args: string[]) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** Files changed since `base` (committed or not), or null when there is no base to compare with. */
function changedFiles(base: string): string[] | null {
  const fork = git('merge-base', 'HEAD', base);
  if (!fork) return null;
  // Without --no-renames a file moved out of src/engine/ would only list its new home.
  const tracked = git('diff', '--name-only', '--no-renames', fork) ?? '';
  const untracked = git('ls-files', '--others', '--exclude-standard') ?? '';
  return [...new Set([...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean))];
}

// ───────── Arguments ─────────

const FLAGS = ['--all', '--quick', '--plan', '--base', '--help', '-h'];
const argv = process.argv.slice(2).flatMap((a) => (a.startsWith('--base=') ? ['--base', a.slice(7)] : [a]));
const flag = (f: string) => argv.includes(f);
const baseAt = argv.indexOf('--base');
const asked = [...new Set(argv.filter((a, i) => !a.startsWith('-') && argv[i - 1] !== '--base'))];

if (flag('--help') || flag('-h')) {
  console.log(
    readFileSync(new URL(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^\/\*\*\n/, '')
      .replace(/^ \* ?/gm, ''),
  );
  console.log('Checks: ' + NAMES.join(', '));
  process.exit(0);
}
const bad = [
  ...argv.filter((a) => a.startsWith('-') && !FLAGS.includes(a)),
  ...asked.filter((a) => !(NAMES as string[]).includes(a)),
];
if (bad.length || (baseAt >= 0 && !argv[baseAt + 1])) {
  console.error(
    `Unknown or incomplete: ${bad.join(', ') || '--base needs a ref'}. Checks: ${NAMES.join(', ')}. Flags: ${FLAGS.join(' ')}`,
  );
  process.exit(2);
}
const base =
  baseAt >= 0 ? argv[baseAt + 1] : git('rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : 'main';

let names: Name[];
let why: string;
if (flag('--all')) [names, why] = [NAMES, 'all checks'];
else if (asked.length) [names, why] = [asked as Name[], 'asked for'];
else {
  const files = changedFiles(base);
  if (files === null) [names, why] = [NAMES, `no ${base} to compare with, so all checks`];
  else [names, why] = [plan(files), `${files.length} file(s) changed vs ${base}`];
}
const skipped = flag('--quick') ? names.filter((n) => (CHECKS[n] as Check).slow) : [];
names = names.filter((n) => !skipped.includes(n));

if (flag('--plan')) {
  console.log(JSON.stringify(names));
  process.exit(0);
}

// ───────── Run ─────────

interface Result {
  name: Name;
  ok: boolean;
  secs: number;
  summary: string;
  detail: string[];
}

const LOGS = '.check';
const DOC = 'docs/ATTRIBUTES.md';
const FLAGGED = /▲|▼|⚠|Needs attention|FAIL|Error|error TS/;
const MAX_DETAIL = 40;
const inCI = !!process.env.CI;

async function run(name: Name): Promise<Result> {
  const check: Check = CHECKS[name];
  const docBefore = name === 'audit' && existsSync(DOC) ? readFileSync(DOC, 'utf8') : null;
  const t0 = Date.now();
  const log = createWriteStream(`${LOGS}/${name}.log`).on('error', () => {}); // a log we can't write mustn't sink the run
  let out = '';
  const code = await new Promise<number>((resolve) => {
    // NO_COLOR, not FORCE_COLOR=0: vitest and vite read any FORCE_COLOR as "on".
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    // npm and npx are .cmd shims on Windows, which only a shell can start.
    const child = spawn(check.cmd[0], check.cmd.slice(1), { shell: process.platform === 'win32', env });
    const take = (s: string) => {
      out += s;
      log.write(s);
    };
    // Decode as text per stream, so a ▲ split across two chunks stays a ▲.
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.on('error', (e) => (take(String(e)), resolve(1)));
    child.on('close', (c) => resolve(c ?? 1));
  });
  log.end();
  const lines = out
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trimEnd());
  const hits = check.summary ? lines.filter((l) => check.summary!.test(l)) : [];
  let summary = (hits.at(-1)?.match(check.summary!)?.[0] ?? (code ? `exit code ${code}` : 'ok')).trim();
  let ok = code === 0;
  // A full audit regenerates the attribute doc; in CI the committed copy must match what the engine does.
  if (docBefore !== null && existsSync(DOC) && readFileSync(DOC, 'utf8') !== docBefore) {
    if (inCI) [ok, summary] = [false, `${summary}; ${DOC} is out of date: run \`npm run audit\` and commit it`];
    else summary += `; it rewrote ${DOC}: commit it with your change`;
  }
  const notSummary = (l: string) => !hits.includes(l);
  let detail: string[];
  // Warnings (⚠) show on a pass too: outliers and known engine issues that don't fail a run.
  if (ok) detail = lines.filter((l) => l.includes('⚠'));
  else {
    const picked = lines.filter((l) => l && notSummary(l) && (check.detail ?? FLAGGED).test(l));
    detail = picked.length ? picked : lines.filter((l) => l && notSummary(l)).slice(-30);
  }
  if (detail.length > MAX_DETAIL)
    detail = [...detail.slice(0, MAX_DETAIL), `… ${detail.length - MAX_DETAIL} more in ${LOGS}/${name}.log`];
  return { name, ok, secs: (Date.now() - t0) / 1000, summary, detail };
}

/** Longest first, starting each check once enough cores are free (a big one takes the whole machine). */
async function runAll(list: Name[]): Promise<Result[]> {
  const queue = [...list].sort((a, b) => (CHECKS[b] as Check).secs - (CHECKS[a] as Check).secs);
  const results: Result[] = [];
  let free = CORES;
  return new Promise((resolve) => {
    const pump = () => {
      for (let i = 0; i < queue.length; i++) {
        const name = queue[i];
        const cores = Math.min((CHECKS[name] as Check).cores, CORES);
        // Never start a check that won't fit beside the running ones, unless nothing is running.
        if (cores > free && free < CORES) continue;
        queue.splice(i--, 1);
        free -= cores;
        console.log(`▶ ${name}`);
        run(name)
          .catch((e): Result => ({ name, ok: false, secs: 0, summary: `harness error: ${e}`, detail: [] }))
          .then((r) => {
            free += cores;
            results.push(r);
            report(r);
            if (results.length === list.length) resolve(results);
            else pump();
          });
      }
    };
    if (!list.length) resolve(results);
    else pump();
  });
}

const fmt = (secs: number) => {
  const s = Math.round(secs);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

function report(r: Result) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(10)} ${fmt(r.secs).padStart(6)}  ${r.summary}`);
  for (const l of r.detail) console.log(`    ${l}`);
  if (!r.ok) console.log(`    full log: ${LOGS}/${r.name}.log`);
}

console.log(`AFLS checks: ${names.length ? names.join(', ') : 'none needed'} (${why})`);
if (skipped.length) console.log(`Skipped by --quick: ${skipped.join(', ')} (CI runs them)`);
if (asked.length && !names.length) console.log('Every check asked for was skipped: drop --quick to run them.');
mkdirSync(LOGS, { recursive: true });
const t0 = Date.now();
const results = await runAll(names);
const failed = results.filter((r) => !r.ok);

console.log(
  `\n${failed.length ? `${failed.length} of ${results.length} check(s) failed: ${failed.map((r) => r.name).join(', ')}` : `All ${results.length} check(s) passed`} in ${fmt((Date.now() - t0) / 1000)}`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    '| Check | Result | Time | Summary |',
    '|---|---|---|---|',
    ...results.map(
      (r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${fmt(r.secs)} | ${r.summary.replace(/\|/g, '\\|')} |`,
    ),
    ...results
      .filter((r) => r.detail.length)
      .map(
        (r) =>
          `\n<details${r.ok ? '' : ' open'}><summary>${r.name}${r.ok ? ': notes' : ': flagged lines'}</summary>\n\n\`\`\`\n${r.detail.join('\n')}\n\`\`\`\n</details>`,
      ),
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}

if (failed.length) process.exitCode = 1;
