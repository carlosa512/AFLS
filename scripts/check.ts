/**
 * One command for every engine check. It picks the checks a change needs (the rules below are the
 * ones CLAUDE.md lists, widened where a file reaches further than its folder), runs them side by
 * side, prints one line each and exits non-zero if any fails. CI runs the same plan, one job per
 * check, so local runs and pull requests agree.
 *
 *   npm run check                  # what changed vs origin/main: commits, edits and new files
 *   npm run check -- --quick       # same, minus the slow ones (careers, audit): CI still runs them
 *   npm run check -- --all         # every check
 *   npm run check -- sim careers   # just these
 *   npm run check -- --base HEAD~3 # changes since another ref
 *   npm run check -- --plan        # print the plan as JSON and run nothing (CI uses this)
 *
 * Full logs go to .check/<name>.log; a failure prints the lines that flagged it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

interface Check {
  cmd: string[];
  /** CPU cores it keeps busy, so a local run doesn't oversubscribe the machine. */
  cores: number;
  /** Too slow for `--quick`. */
  slow?: boolean;
  /** The line that sums the run up (the last match wins). */
  summary?: RegExp;
}

const CORES = availableParallelism();

const CHECKS = {
  typecheck: { cmd: ['npm', 'run', 'typecheck'], cores: 1, summary: /error TS\d+.*/ },
  test: { cmd: ['npm', 'test'], cores: CORES, summary: /Tests\s+.*/ },
  build: { cmd: ['npx', 'vite', 'build', '--logLevel', 'error'], cores: 1 },
  sim: { cmd: ['npm', 'run', 'sim', '--', '10'], cores: 1, summary: /\d+ stat\(s\) outside target range/ },
  endings: { cmd: ['npm', 'run', 'endings', '--', '5000'], cores: 1, summary: /\d+ flagged ending\(s\)/ },
  offseason: { cmd: ['npm', 'run', 'offseason', '--', '6'], cores: 1, summary: /\d+ number\(s\) outside target range/ },
  // Four leagues in child processes plus the cohort curves in the parent.
  careers: { cmd: ['npm', 'run', 'careers'], cores: 4, slow: true, summary: /\d+ number\(s\) outside target range/ },
  audit: { cmd: ['npm', 'run', 'audit'], cores: 1, slow: true, summary: /Needs attention.*|Every attribute.*/ },
} satisfies Record<string, Check>;

type Name = keyof typeof CHECKS;
const NAMES = Object.keys(CHECKS) as Name[];
const ENGINE: Name[] = ['typecheck', 'test', 'sim', 'endings', 'offseason', 'careers'];

/**
 * Which checks a changed file calls for; a file collects every rule it matches. Any change to how
 * the engine plays runs the cheap league checks and `careers`, whose long-run leaders and scoring
 * read the match engine and schemes as much as aging (a schemes change once broke its passing
 * records with nobody the wiser). `audit` follows whatever decides who plays and how ratings count.
 */
const RULES: [RegExp, Name[]][] = [
  [/^src\/engine\/.*\.test\.ts$/, ['typecheck', 'test']],
  [/^src\/engine\/(?!.*\.test\.ts$)/, ENGINE],
  [/^src\/engine\/(match\/|attributes\.ts|positions\.ts|schemes\.ts|roster\.ts|generate\.ts|rng\.ts|types\.ts)/, ['audit']],
  [/^src\/(?!engine\/)|^index\.html$|^vite\.config\.ts$/, ['typecheck', 'build']],
  [/^scripts\/calibrate\.ts$/, ['sim']],
  [/^scripts\/leaders\.ts$/, ['sim', 'careers']],
  [/^scripts\/endings\.ts$/, ['endings']],
  [/^scripts\/offseason\.ts$/, ['offseason']],
  [/^scripts\/careers(-league)?\.ts$/, ['careers']],
  [/^scripts\/audit\.ts$/, ['audit']],
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
  const tracked = git('diff', '--name-only', fork) ?? '';
  const untracked = git('ls-files', '--others', '--exclude-standard') ?? '';
  return [...new Set([...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean))];
}

// ───────── Arguments ─────────

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const baseAt = argv.indexOf('--base');
const base = baseAt >= 0 ? argv[baseAt + 1] : git('rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : 'main';
const asked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--base');

if (flag('--help') || flag('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
  console.log('Checks: ' + NAMES.join(', '));
  process.exit(0);
}
const unknown = asked.filter((a) => !(NAMES as string[]).includes(a));
if (unknown.length) {
  console.error(`Unknown check(s): ${unknown.join(', ')}. Checks: ${NAMES.join(', ')}`);
  process.exit(2);
}

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
  /** A full run of `audit` rewrote docs/ATTRIBUTES.md. */
  docChanged?: boolean;
}

const LOGS = '.check';
const DOC = 'docs/ATTRIBUTES.md';
const FLAGGED = /▲|▼|Needs attention|FAIL|Error|error TS|flagged|known issue|✗|×/;

async function run(name: Name): Promise<Result> {
  const check: Check = CHECKS[name];
  const docBefore = name === 'audit' && existsSync(DOC) ? readFileSync(DOC, 'utf8') : null;
  const t0 = Date.now();
  const log = createWriteStream(`${LOGS}/${name}.log`);
  let out = '';
  const code = await new Promise<number>((resolve) => {
    // npm and npx are .cmd shims on Windows, which only a shell can start.
    const child = spawn(check.cmd[0], check.cmd.slice(1), { shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '0' } });
    const take = (b: Buffer) => {
      out += b;
      log.write(b);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => (take(Buffer.from(String(e))), resolve(1)));
    child.on('close', (c) => resolve(c ?? 1));
  });
  log.end();
  const lines = out.split('\n').map((l) => l.trimEnd());
  const hits = check.summary ? lines.filter((l) => check.summary!.test(l)) : [];
  const summary = (hits.at(-1)?.match(check.summary!)?.[0] ?? (code ? `exit code ${code}` : 'ok')).trim();
  const flagged = lines.filter((l) => FLAGGED.test(l));
  const detail = code ? (flagged.length ? flagged : lines.filter(Boolean).slice(-30)).slice(0, 40) : flagged.filter((l) => /known issue/.test(l));
  const docChanged = docBefore !== null && existsSync(DOC) && readFileSync(DOC, 'utf8') !== docBefore;
  return { name, ok: code === 0, secs: (Date.now() - t0) / 1000, summary, detail, docChanged };
}

/** Longest first, starting each check once enough cores are free (a big one takes the whole machine). */
async function runAll(list: Name[]): Promise<Result[]> {
  const ORDER: Name[] = ['careers', 'audit', 'test', 'offseason', 'sim', 'build', 'typecheck', 'endings'];
  const queue = [...list].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
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
        run(name).then((r) => {
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

const fmt = (s: number) => (s < 60 ? `${s.toFixed(0)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`);

function report(r: Result) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(10)} ${fmt(r.secs).padStart(6)}  ${r.summary}`);
  for (const l of r.detail) console.log(`    ${l}`);
  if (!r.ok) console.log(`    full log: ${LOGS}/${r.name}.log`);
}

console.log(`AFLS checks: ${names.length ? names.join(', ') : 'none needed'} (${why})`);
if (skipped.length) console.log(`Skipped by --quick: ${skipped.join(', ')} (CI runs them)`);
mkdirSync(LOGS, { recursive: true });
const t0 = Date.now();
const results = await runAll(names);
const failed = results.filter((r) => !r.ok);
const inCI = !!process.env.CI;

// A full audit regenerates the attribute doc; the committed copy must match what the engine does.
const staleDoc = results.some((r) => r.docChanged);
if (staleDoc) {
  if (inCI) console.log(`\n✗ ${DOC} is out of date: run \`npm run audit\` and commit the file.`);
  else console.log(`\nnpm run audit rewrote ${DOC}: commit it with your change.`);
}

console.log(`\n${failed.length ? `${failed.length} of ${results.length} check(s) failed: ${failed.map((r) => r.name).join(', ')}` : `All ${results.length} check(s) passed`} in ${fmt((Date.now() - t0) / 1000)}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    '| Check | Result | Time | Summary |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${fmt(r.secs)} | ${r.summary.replace(/\|/g, '\\|')} |`),
    ...(staleDoc && inCI ? ['', `❌ \`${DOC}\` is out of date: run \`npm run audit\` and commit it.`] : []),
    ...results
      .filter((r) => r.detail.length)
      .map((r) => `\n<details${r.ok ? '' : ' open'}><summary>${r.name}${r.ok ? ' notes' : ': flagged lines'}</summary>\n\n\`\`\`\n${r.detail.join('\n')}\n\`\`\`\n</details>`),
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}

if (failed.length || (staleDoc && inCI)) process.exitCode = 1;
