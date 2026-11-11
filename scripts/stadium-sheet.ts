/**
 * The owner's stadium review pages: `npm run stadiums -- <group> [--time]`. A preview, not a check, except with
 * `--time`: it then paints each building at a phone's size with the processor slowed six times and fails if one costs
 * more than 1.9 times a fixed job timed beside it. Pages land in `.check/stadiums/<group>.html`, self-contained.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

/**
 * A building may cost this many times the fixed job (20,000 small shapes): about 360 ms where that job takes 190.
 * The owner's number: 1.6 while the crowd was part of the one picture, raised to 1.9 (0.4.31) for the canvases the
 * crowd jumps on, which add about a fifth to a painting; a game paints its building once, not twice, since then.
 */
const LIMIT = 1.9;
const SLOWDOWN = 6;
const args = process.argv.slice(2);
const group = args.find((a) => !a.startsWith('--')) ?? 'agreed';
const time = args.includes('--time');

const seg = (label: string, key: string, options: [string, string][]) =>
  `<span class="ctl"><span>${label}</span><span class="seg">${options.map(([v, text], i) => `<button data-set="${key}:${v}" aria-pressed="${i === 0}">${text}</button>`).join('')}</span></span>`;
const page = (js: string) => `<title>Stadium Review: ${group}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
  :root { color-scheme: dark; --bg: #0d1210; --raise: #1c2722; --ink: #e9efea; --muted: #93a198; --line: #29342e; --marker: #ffd43b; --marker-ink: #1f1900; }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; padding-block: 24px 56px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .wrap { max-width: 1180px; margin-inline: auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
  p { margin: 0; max-width: 66ch; color: var(--muted); }
  h1 { margin: 0; font-size: clamp(28px, 5vw, 40px); line-height: 1.1; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px 18px; }
  .ctl { display: inline-flex; gap: 8px; align-items: center; color: var(--muted); font-size: 14px; }
  .seg { display: inline-flex; background: var(--raise); border-radius: 999px; padding: 3px; }
  .seg button { font: 600 13px ui-monospace, Menlo, monospace; color: var(--muted); background: none; border: 0; padding: 7px 12px; border-radius: 999px; cursor: pointer; }
  .seg button[aria-pressed="true"] { background: var(--marker); color: var(--marker-ink); }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  #root { display: grid; gap: 22px 18px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 900px) { #root { grid-template-columns: repeat(2, minmax(0, 1fr)); } #root figure:first-child:nth-last-child(odd) { grid-column: 1 / -1; } }
  figure { margin: 0; display: grid; gap: 6px; min-width: 0; }
  figure.phone { max-width: 390px; }
  canvas { display: block; width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--line); background: #000; }
  figcaption { font-size: 14px; color: var(--muted); }
</style>
<div class="wrap">
  <h1 id="title"></h1>
  <p id="notes"></p>
  <div class="bar">
    ${seg('Crowd', 'turnout', [
      ['winning', 'Winning'],
      ['even', 'Even'],
      ['losing', 'Losing'],
    ])}
    ${seg('Light', 'light', [
      ['day', 'Day'],
      ['night', 'Night'],
    ])}
    ${seg('Weather', 'precip', [
      ['none', 'Clear'],
      ['rain', 'Rain'],
      ['snow', 'Snow'],
      ['lying', 'Snow lying'],
    ])}
    ${seg('Roof', 'roof', [
      ['open', 'Open'],
      ['closed', 'Closed'],
    ])}
  </div>
  <div id="root"></div>
</div>
<script>${js}</script>`;

const out = await build({
  entryPoints: ['src/ui/stadiums/sheet.ts'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  define: { GROUP: JSON.stringify(group) },
  logLevel: 'error',
});
mkdirSync('.check/stadiums', { recursive: true });
const file = `.check/stadiums/${group}.html`;
writeFileSync(file, page(out.outputFiles[0].text.replace(/<\/script/g, '<\\/script')));
console.log(`wrote ${file}`);

if (time) {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await tab.goto(`file://${process.cwd()}/${file}`);
  const cdp = await tab.context().newCDPSession(tab);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  // A shared machine's speed swings by a fifth from run to run, so a building is judged against a fixed job timed in
  // the same breath (20,000 small filled shapes), each taken as the best of five: the ratio holds when the clock does not.
  const runs: { job: number; ms: Record<string, number> }[] = [];
  for (let i = 0; i < 5; i++)
    runs.push(
      await tab.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1170;
        c.height = 611;
        const g = c.getContext('2d')!;
        const t0 = performance.now();
        for (let n = 0; n < 20000; n++) {
          g.fillStyle = n % 7 ? '#334455' : '#aa5533';
          g.beginPath();
          const x = (n * 37) % 1100;
          const y = (n * 91) % 580;
          g.rect(x, y, 9, 6);
          g.fill();
        }
        g.getImageData(0, 0, 1, 1);
        const job = performance.now() - t0;
        return { job, ms: (window as unknown as { timeAll: () => Record<string, number> }).timeAll() };
      }),
    );
  await browser.close();
  const job = Math.min(...runs.map((r) => r.job));
  console.log(`fixed job ${Math.round(job)} ms (processor slowed ${SLOWDOWN}×)`);
  let over = 0;
  for (const club of Object.keys(runs[0].ms)) {
    const t = Math.min(...runs.map((r) => r.ms[club]));
    const ratio = t / job;
    console.log(`${ratio > LIMIT ? '✗' : '✓'} ${club} ${t} ms, ${ratio.toFixed(2)}× the fixed job (limit ${LIMIT}×)`);
    if (ratio > LIMIT) over++;
  }
  if (over) process.exit(1);
}
