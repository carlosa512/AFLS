/**
 * `npm run cap-books [-- seed seasons]`: where cap room goes, season by season, read the way the offseason check's
 * drift lines read it (`cap-books-core.ts`). A preview, not a check: what the cap books were steered with
 * (`docs/superpowers/specs/2026-11-18-multi-year-cap-books-design.md`). Defaults: `offseason-audit-3`, 10 seasons.
 */
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { beginOffseason } from '../src/engine/offseason';
import { playToKickoff } from './cap-books-core';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seed = args[0] ?? 'offseason-audit-3';
const seasons = Number(args[1] ?? 10);
const l = createLeague({ seed, personnel: true });
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a').padStart(6);
console.log(`cap books, ${seed}, ${seasons} seasons (medians a club unless marked mean; % of the cap)`);
console.log('season   room  FA signed  camp roster  next yr used  restr. later (mean)  camp dead (mean)');
for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(l);
  beginOffseason(l);
  const k = playToKickoff(l);
  console.log(
    `${k.season}  ${f(k.room)}  ${f(k.faSigned, 0)}     ${f(k.campRoster, 0)}       ${f(k.committed)}        ${f(k.restructureLater)}              ${f(k.campDead, 2)}`,
  );
}
