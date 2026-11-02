# Helmets, helmet decals and the quarterback's gear: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player avatar wears a helmet in his club's design (eight shells, decals, masks by position), and
quarterbacks get padded sleeves and a play-call wristband, all editable from the card's pencil.

**Architecture:** Pure UI work on the avatar, like the gear pass before it: rules in small pure modules
(`ui/helmet.ts`, `ui/playerGear.ts`), drawing in their art modules (`ui/helmetArt.tsx`, `ui/flags.tsx`,
`ui/gearArt.tsx`), wired into `PlayerAvatar`. The engine only gains types, the 32 club designs on the seeds and a save
step. All drawing data (paths, spots, numbers) is ported from the mockup source beside the spec.

**Tech Stack:** TypeScript, React 19 (SVG), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-helmets-qb-gear-design.md` · drawing reference:
`docs/superpowers/specs/2026-11-02-helmets-qb-gear-mockup.tsx` (its header maps its working keys to the game's).

## Global Constraints

- No maker or model names anywhere in the game, code identifiers and copy included: never `Riddell`, `Schutt`, `Vicis`,
  `Xenith`, `Axiom`, `SpeedFlex`, `F7`, `Vengeance`, `Zero2`, `Trench`, `Shadow`. Port the mockup with its keys renamed:
  `axiom → modern`, `axiomLite → modernSmooth`, `f7 → plated`, `veng → classic`, `zero2 → pod`, `zero2t → podWide`,
  `ridge → ridgeback`, `oldmod → retro`. Leave out `r1`, `f7r5`/`f7r6`, `vengR5`/`vengR6`, `xr`, `facet`, `HairLayer`,
  the `legacy` hooks and the `tails` strap ends.
- Nothing reads `player.ratings`, `playerOvr` or `potential`; no `Math.random` (stable picks go through `pick(id, salt,
  n)` from `ui/staffLook.ts`, as `playerGear.ts` does).
- `League` stays plain JSON; `SAVE_VERSION` 74 → 75 with an upgrade step in `migrate.ts`.
- Comments explain why, in the project's voice; small pure functions.
- Per task: `npm run typecheck` and the tests you touched (`npx vitest run <file>`); `npm run format` before each commit.
  Never `npm run check` (CI runs it). Commits end with the session's attribution lines.
- Branch `claude/gallant-johnson-gqsz8w`; commit messages in the repo's style (`Avatars: …`).

## Review Focus

- A player who changes status mid-season (released, drafted, retired) must change look with it: bare head as a free
  agent, prospect or retiree, his club's helmet once drafted or signed. Test in Task 6.
- A club without a design (a mod's, or one an old save couldn't match) must still get a readable helmet from the
  fallback rule, never a crash or an undefined colour. Tests in Tasks 2 and 6.
- A club with no available QB or LB (injuries, an empty chart) must not crash the green dot; it falls to a safety or
  to nobody. Test in Task 2.
- A white shell on a pale backdrop or white away jersey must keep its outline so it doesn't vanish. Test in Task 5.
- Gear chosen in the editor before this change (a v74 `Player.gear` without `helmet` or `wristband`) must keep working:
  his own shell, and no wristband unless picked. Test in Task 2 (helmet) and Task 3 (wristband).

---

### Task 1: Types, the 32 club designs and the save step

**Files:**
- Modify: `src/engine/types.ts` (near `Gear`, line ~174; `Team`, line ~837)
- Modify: `src/engine/data/teams.ts` (`TeamSeed`, the 32 seeds)
- Modify: `src/engine/generate.ts:51` (`SAVE_VERSION`) and the team builder (~line 770)
- Modify: `src/engine/migrate.ts` (after the v74 step)
- Test: `src/engine/helmets.test.ts` (new)

**Interfaces:**
- Produces, in `types.ts`:
  `type HelmetModel = 'modern' | 'modernSmooth' | 'plated' | 'classic' | 'pod' | 'podWide' | 'ridgeback' | 'retro'`;
  `interface HelmetDesign { shell: string; finish: 'gloss' | 'matte' | 'metal'; stripe: 'none' | 'single' | 'double' | 'triple'; stripeA?: string; stripeB?: string; number?: { ink: string; trim: string }; bumper: string; mask: string }`;
  `Gear.helmet?: HelmetModel`; `Gear.wristband?: { side: 'left' | 'right'; color: GearColor }`; `Team.helmet?: HelmetDesign`.
- Produces, in `data/teams.ts`: `TeamSeed.helmet?: HelmetDesign`, set on all 32 seeds.

- [ ] **Step 1: Write the failing tests** in `src/engine/helmets.test.ts`:

```ts
it('gives every default club a helmet design', () => {
  for (const s of TEAM_SEEDS) expect(s.helmet, s.abbrev).toBeDefined();
});
it("copies each club's design into a new league", () => {
  const league = createLeague({ seed: 'helmets' });
  league.teams.forEach((t, i) => {
    expect(t.helmet).toEqual(TEAM_SEEDS[i].helmet);
    expect(t.helmet).not.toBe(TEAM_SEEDS[i].helmet); // a copy: editing a save never edits the seeds
  });
});
it("gives an older save its clubs' designs by abbreviation, and leaves a mod's club without one", () => {
  const league = createLeague({ seed: 'helmets' });
  for (const t of league.teams) delete t.helmet;
  league.teams[3].abbrev = 'XYZ';
  league.version = 74;
  const out = migrateLeague(league)!;
  expect(out.version).toBe(75);
  expect(out.teams[0].helmet).toEqual(TEAM_SEEDS[0].helmet);
  expect(out.teams[3].helmet).toBeUndefined();
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/helmets.test.ts`. Expected: FAIL (no `helmet` on the seeds).

- [ ] **Step 3: Add the types**, and the 32 designs to the seeds exactly as the spec's table ("Each club's design"):
  white shells `#F2F4F6`, grey mask `#9AA3AD`, black mask `#1A1D22`, white mask `#F2F4F6`; "triple A / B" means
  `stripeA: A, stripeB: B`; "double A" and "single A" set `stripeA` only; "A on B" is `number: { ink: A, trim: B }`;
  "none" leaves `number` out. Add a doc comment on `TeamSeed.helmet` (the club's helmet, the same home and away; a mod
  can leave it out for the fallback in `ui/helmet.ts`).

- [ ] **Step 4: Copy the design in `createLeague`** (`helmet: seedTeam.helmet && structuredClone(seedTeam.helmet)` or
  the JSON round-trip the file already uses), **bump `SAVE_VERSION` to 75**, and **add the v75 step** in
  `migrateLeague`: for each team without `helmet`, copy the seed whose `abbrev` matches (cloned); comment it like the
  steps above (`Gear.helmet`, `Gear.wristband` and the two new sleeve lengths are optional or additive: nothing to
  rewrite).

- [ ] **Step 5: Run** `npx vitest run src/engine/helmets.test.ts` and `npm run typecheck`. Expected: PASS, no errors.

- [ ] **Step 6: Commit** (`Avatars: club helmet designs on the seeds, saves v75`).

---

### Task 2: The helmet's rules (`src/ui/helmet.ts`)

**Files:**
- Create: `src/ui/helmet.ts`
- Test: `src/ui/helmet.test.ts` (new)

**Interfaces:**
- Consumes: `HelmetModel`, `HelmetDesign`, `Team.helmet` (Task 1); `isProspect` (`engine/scouting.ts`), `originOf`
  (`engine/origin.ts`), `starters` (`engine/roster.ts`), `pick` (`ui/staffLook.ts`), `contrast` and `readableOn`
  (`ui/color.ts`).
- Produces:
  - `HELMET_SCALE = 0.85`, `HELMET_NECK_Y = 38.8`, `HELMET_NECK_PER_TRAP = 0.5`
  - `wearsHelmet(player: Pick<Player, 'teamId' | 'retired' | 'scouting' | 'draft'>, team: Team | null): boolean`
  - `HELMET_LABEL: Record<HelmetModel, string>` (Modern, Modern, smooth, Plated, Classic, Pod, Pod, wide, Ridgeback, Retro)
  - `HELMET_WEIGHTS: Record<'qb' | 'skill' | 'middle' | 'line' | 'kick', Partial<Record<HelmetModel, number>>>`
  - `helmetModelOf(player: Pick<Player, 'id' | 'position' | 'gear'>): HelmetModel`
  - `type MaskKind = 'qb' | 'skill' | 'hybrid' | 'line' | 'kicker'`; `maskOf(position: Position): MaskKind`
  - `helmetDesignOf(team: Pick<Team, 'colors' | 'helmet'>): HelmetDesign`
  - `isDarkShell(hex: string): boolean` (contrast against `#000000` under 2.4)
  - `type FlagCode = 'US' | 'DE' | 'GB' | 'AU' | 'NG' | 'MX' | 'FR' | 'AT' | 'IT' | 'BR' | 'JP' | 'GH' | 'NZ' | 'CA' | 'IE' | 'SE'`;
    `PATHWAY_FLAGS: Record<string, FlagCode>` keyed by the origin's name; `flagsOf(player: Pick<Player, 'origin'>): FlagCode[]`
  - `greenDotOf(league: League, team: Team, player: Pick<Player, 'id'>): boolean`

- [ ] **Step 1: Write the failing tests** in `src/ui/helmet.test.ts`:

```ts
it('puts a helmet on a player with a club, never on a free agent, prospect or retiree', () => {
  const team = { id: 0, colors: ['#1D4ED8', '#FFFFFF'] } as Team;
  expect(wearsHelmet({ teamId: 0 } as Player, team)).toBe(true);
  expect(wearsHelmet({ teamId: null } as Player, null)).toBe(false);
  expect(wearsHelmet({ teamId: 0, retired: true } as Player, team)).toBe(false);
  expect(wearsHelmet({ teamId: null, scouting: {} } as unknown as Player, team)).toBe(false); // a prospect
});
it('picks each position group its shells by their weights, and your pick wins', () => {
  const groups = { qb: 'QB', skill: 'WR', middle: 'LB', line: 'OL', kick: 'K' } as const;
  for (const [group, position] of Object.entries(groups)) {
    const w = HELMET_WEIGHTS[group as keyof typeof HELMET_WEIGHTS];
    const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    const picks = Array.from({ length: 4000 }, (_, i) => helmetModelOf({ id: i + 1, position }));
    for (const m of Object.keys(HELMET_LABEL) as HelmetModel[])
      expect(picks.filter((x) => x === m).length / 4000, `${group} ${m}`).toBeCloseTo((w[m] ?? 0) / total, 1);
  }
  expect(helmetModelOf({ id: 9, position: 'QB', gear: { helmet: 'retro' } })).toBe('retro');
  expect(helmetModelOf({ id: 9, position: 'QB', gear: {} })).toBe(helmetModelOf({ id: 9, position: 'QB' })); // a v74 pick
});
it('fits the mask to the position', () => {
  expect(maskOf('QB')).toBe('qb');
  for (const p of ['RB', 'WR', 'CB', 'S'] as const) expect(maskOf(p)).toBe('skill');
  for (const p of ['LB', 'EDGE', 'TE'] as const) expect(maskOf(p)).toBe('hybrid');
  for (const p of ['OL', 'DT'] as const) expect(maskOf(p)).toBe('line');
  for (const p of ['K', 'P'] as const) expect(maskOf(p)).toBe('kicker');
});
it("reads every club's design so its stripe and number stand off the shell", () => {
  for (const s of TEAM_SEEDS) {
    const d = s.helmet!;
    const stripe = Math.max(contrast(d.shell, d.stripeA ?? d.shell), contrast(d.shell, d.stripeB ?? d.stripeA ?? d.shell));
    if (d.stripe !== 'none') expect(stripe, s.abbrev).toBeGreaterThanOrEqual(2);
    if (d.number) expect(Math.max(contrast(d.shell, d.number.ink), contrast(d.shell, d.number.trim)), s.abbrev).toBeGreaterThanOrEqual(2.4);
  }
});
it("falls back to the club's colours when it has no design", () => {
  const d = helmetDesignOf({ colors: ['#123456', '#EEEEEE'] });
  expect(d).toMatchObject({ shell: '#123456', finish: 'gloss', stripe: 'single', bumper: '#EEEEEE', mask: '#9AA3AD' });
  expect(d.number).toBeUndefined();
  expect(contrast(d.shell, d.stripeA!)).toBeGreaterThanOrEqual(1.8);
  // a secondary that doesn't stand off the primary is swapped for light or dark
  expect(helmetDesignOf({ colors: ['#101820', '#203731'] }).stripeA).not.toBe('#203731');
});
it('flies the US flag on every helmet and a Pathway player’s country under it, never a CFL arrival’s', () => {
  for (const i of PATHWAY_ORIGINS) expect(flagsOf({ origin: i })).toEqual(['US', PATHWAY_FLAGS[ORIGINS[i].name]]);
  for (const name of PATHWAY_ORIGINS.map((i) => ORIGINS[i].name)) expect(PATHWAY_FLAGS[name], name).toBeDefined();
  expect(flagsOf({ origin: ORIGINS.findIndex((o) => o.kind === 'cfl') })).toEqual(['US']);
  expect(flagsOf({ origin: 0 })).toEqual(['US']); // a college
  expect(flagsOf({})).toEqual(['US']);
});
it('puts one green dot on each side: the starting QB and the first LB, or a safety', () => {
  const league = createLeague({ seed: 'dots' });
  for (const team of league.teams) {
    const dotted = teamPlayers(league, team.id).filter((p) => greenDotOf(league, team, p));
    expect(dotted.map((p) => p.id).sort()).toEqual([starters(league, team, 'QB')[0].id, starters(league, team, 'LB')[0].id].sort());
  }
  const team = league.teams[0];
  team.depthChart.LB = [];
  expect(greenDotOf(league, team, starters(league, team, 'S')[0])).toBe(true);
  team.depthChart.QB = []; team.depthChart.S = [];
  expect(() => teamPlayers(league, team.id).forEach((p) => greenDotOf(league, team, p))).not.toThrow();
});
it('names the shells in our own words', () => {
  const banned = /Riddell|Schutt|Vicis|Xenith|Axiom|SpeedFlex|\bF7\b|Vengeance|Zero2|Trench|Shadow/i;
  for (const f of ['helmet.ts', 'helmetArt.tsx', 'flags.tsx'])
    if (existsSync(`src/ui/${f}`)) expect(readFileSync(`src/ui/${f}`, 'utf8'), f).not.toMatch(banned);
  for (const n of Object.values(HELMET_LABEL)) expect(n).not.toMatch(banned);
});
it('calls a shell dark when it would melt into a dark jersey', () => {
  expect(isDarkShell('#101820')).toBe(true);
  expect(isDarkShell('#ffb612')).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/helmet.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/ui/helmet.ts`.**
  - `HELMET_WEIGHTS` is the spec's table: `qb` (QB), `skill` (RB, WR, CB, S), `middle` (LB, EDGE, TE), `line` (OL, DT),
    `kick` (K, P), leaving out the dashes.
  - `helmetModelOf`: `player.gear?.helmet`, else a weighted draw from `pick(String(id), 'helmet', 1_000_000)`, as
    `weighted` does in `playerGear.ts`.
  - `helmetDesignOf`: `team.helmet`, else the fallback: the primary as a gloss shell, a single stripe in the secondary
    when `contrast(primary, secondary) >= 1.8` and otherwise `readableOn(primary, secondary)`, no number, the
    secondary as bumper, a grey mask (`#9AA3AD`).
  - `PATHWAY_FLAGS` maps the 15 names in `data/origins.ts` (Germany, United Kingdom, Australia, Nigeria, Mexico, France,
    Austria, Italy, Brazil, Japan, Ghana, New Zealand, Canada, Ireland, Sweden) to their codes. `flagsOf` uses `originOf`.
  - `greenDotOf`: the player is `starters(league, team, 'QB')[0]`, or `(starters(league, team, 'LB')[0] ?? starters(league, team, 'S')[0])`.

- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** (`Avatars: helmet rules: who wears one, which shell, the mask, the club's design, flags and the green dot`).

---

### Task 3: The quarterback's gear rules (`src/ui/playerGear.ts`)

**Files:**
- Modify: `src/engine/types.ts:178` (`SleeveLength` gains `'padded' | 'paddedElbow'`)
- Modify: `src/ui/playerGear.ts` (`Rates`, `GEAR_RATES.QB`, `ownGear`, `gearOf`)
- Modify: `src/ui/gearArt.tsx` (`SLEEVE` ranges: `padded: [55, 140]`, `paddedElbow: [71.5, 97]`; the pad comes in Task 4)
- Modify: `src/ui/screens/PlayerCard.tsx` (`SLEEVE_LABEL`: `padded: 'Padded'`, `paddedElbow: 'Padded elbow'`)
- Test: `src/ui/playerGear.test.ts`

**Interfaces:**
- Consumes: `Gear.wristband` (Task 1).
- Produces: `GEAR_RATES.QB.padded = 40`, `GEAR_RATES.QB.paddedElbow = 20` (length weights); `PADDED_BOTH = 0.15`;
  `WRISTBAND_QB = 0.6`; `WRISTBAND_RIGHT = 0.25`; `WRIST_COLORS` (white 40, black 30, primary 15, secondary 15).

- [ ] **Step 1: Write the failing tests** in `src/ui/playerGear.test.ts` (the file's `players`, `share` and `N` helpers):

```ts
it('gives quarterbacks padded sleeves inside their usual sleeve mix, mostly on one arm, either one', () => {
  const qbs = players('QB').map((p) => gearOf(p));
  const sleeved = qbs.filter((g) => g.sleeve);
  expect(sleeved.length / N).toBeCloseTo(GEAR_RATES.QB.sleeve!, 1); // unchanged: 40%
  const padded = sleeved.filter((g) => g.sleeve!.length === 'padded' || g.sleeve!.length === 'paddedElbow');
  expect(padded.length / sleeved.length).toBeCloseTo(60 / 205, 1);
  const both = padded.filter((g) => g.sleeve!.side === 'both').length / padded.length;
  expect(both).toBeCloseTo(PADDED_BOTH, 1);
  const left = padded.filter((g) => g.sleeve!.side === 'left').length;
  const right = padded.filter((g) => g.sleeve!.side === 'right').length;
  expect(Math.abs(left - right) / padded.length).toBeLessThan(0.08);
  for (const position of POSITIONS.filter((x) => x !== 'QB'))
    expect(share(position, (g) => g.sleeve?.length === 'padded' || g.sleeve?.length === 'paddedElbow'), position).toBe(0);
});
it('puts a play-call wristband on 60% of quarterbacks, on one wrist, the left for most', () => {
  expect(share('QB', (g) => !!g.wristband)).toBeCloseTo(WRISTBAND_QB, 1);
  const bands = players('QB').map((p) => gearOf(p).wristband).filter(Boolean);
  expect(bands.filter((b) => b!.side === 'right').length / bands.length).toBeCloseTo(WRISTBAND_RIGHT, 1);
  for (const position of POSITIONS.filter((x) => x !== 'QB')) expect(share(position, (g) => !!g.wristband), position).toBe(0);
});
it('dresses a quarterback in plain long sleeves in the cold, and keeps his wristband on', () => {
  for (const p of players('QB')) {
    const warm = gearOf(p);
    const cold = gearOf(p, true);
    // the 85% who dress for the cold wear plain full sleeves; the rest keep their usual gear, padded sleeve included
    if (JSON.stringify(cold) !== JSON.stringify(warm)) expect(cold.sleeve).toMatchObject({ length: 'full', side: 'both' });
    expect(cold.wristband).toEqual(warm.wristband);
  }
});
it('keeps gear you chose before the wristband existed as you chose it', () => {
  expect(gearOf({ id: 5, position: 'QB', gear: { band: { at: 'biceps', color: 'white', side: 'both' } } }).wristband).toBeUndefined();
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/playerGear.test.ts`. Expected: the new tests FAIL; the old ones pass.

- [ ] **Step 3: Implement.**
  - `Rates` gains `padded?` and `paddedElbow?` (length weights); the lengths draw appends them only when set.
  - A padded length's side: `both` for `PADDED_BOTH` of them (own salt), otherwise left or right evenly (own salt). Other
    lengths keep today's side rule (a quarterback's single sleeve on his throwing arm).
  - The wristband is drawn in `ownGear` for quarterbacks only, on its own salts, after the other pieces and **outside**
    the `GEAR_MAX` two-piece limit; the `pieces` helper in the tests doesn't count it.
  - `gearOf` in the cold: today's rule already turns any sleeve into plain full sleeves on both arms; add
    `if (base.wristband) gear.wristband = base.wristband`.

- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS, including every existing gear test.

- [ ] **Step 5: Commit** (`Avatars: padded sleeves and the play-call wristband for quarterbacks`).

---

### Task 4: Drawing the padded sleeves and the wristband (`src/ui/gearArt.tsx`)

**Files:**
- Modify: `src/ui/gearArt.tsx` (`GearLayer`)
- Test: `src/ui/gearArt.test.tsx` (new)

**Interfaces:**
- Consumes: `Gear.sleeve.length` `'padded' | 'paddedElbow'`, `Gear.wristband` (Tasks 1, 3).
- Produces: `GearLayer` draws them; no new exports.

Port from the mockup's `QbSleeveLayer` and `WristLayer` (and their helpers `hexPattern`, `bandPath`), with these values:

| Piece | Values |
| --- | --- |
| Pad | y 76.6 to 91.4, `rx` 3; cylinder mapping around the arm at the elbow's cross-section (`spanOf(arm, 80, 88)`), centred 62° toward the arm's outside (the right arm's right edge, the left arm's left: mirrored), half-width 38°, the honeycomb squeezed by `max(0.45, cos 62°)`; on every arm the sleeve covers |
| Pad colour | black `#3a4048`, white `#c9d0d7`, primary or secondary `shade(colour, 0.3)` |
| `paddedElbow` | the sleeve from 71.5 to 97 with a hem at each end, the pad inside |
| Wristband | a solid band (no trim) from 92 to 104.6 on the wrist's arm; the window from (turn − 44°) to (turn + 44°), turn −75° on the left arm and +75° on the right; window `#EEF2F5`, its header row in the team's primary, grid rows every 1.35, colour cells, a gloss line, the cylinder shading |

- [ ] **Step 1: Write the failing tests** in `src/ui/gearArt.test.tsx`, rendering `<svg><GearLayer id="t" figure={playerLook(qb, 128).figure} gear={…} colors={KC} /></svg>` to markup:

```ts
it('draws a padded sleeve with its honeycomb, on either arm or both, with no NaN', () => {
  for (const side of ['left', 'right', 'both'] as const)
    for (const length of ['padded', 'paddedElbow'] as const) {
      const svg = render({ sleeve: { length, color: 'black', side } });
      expect(svg).toContain('<pattern');
      expect(svg).not.toContain('NaN');
      expect((svg.match(/<pattern/g) ?? []).length).toBe(side === 'both' ? 2 : 1); // a pad per covered arm
    }
});
it('draws the play-call wristband on either wrist, the card behind its window', () => {
  for (const side of ['left', 'right'] as const) {
    const svg = render({ wristband: { side, color: 'white' } });
    expect(svg).toContain('#EEF2F5');
    expect(svg).not.toContain('NaN');
  }
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/gearArt.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** in `GearLayer` (pattern and clip ids prefixed with `id`, like its existing ones).
- [ ] **Step 4: Run** the new test, `src/ui/avatar.test.tsx` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`Avatars: draw the padded sleeves and the wristband`).

---

### Task 5: Drawing the helmet (`src/ui/helmetArt.tsx`, `src/ui/flags.tsx`)

**Files:**
- Create: `src/ui/helmetArt.tsx`, `src/ui/flags.tsx`
- Test: `src/ui/helmetArt.test.tsx` (new)

**Interfaces:**
- Consumes: `HelmetModel`, `HelmetDesign` (Task 1); `MaskKind`, `FlagCode`, `isDarkShell`, `HELMET_SCALE`,
  `HELMET_NECK_Y`, `HELMET_NECK_PER_TRAP` (Task 2).
- Produces:
  - `flags.tsx`: `FLAG_W = 3.4`, `FLAG_H = 2.25`, `FLAG_GAP = 0.35`, `Flag({ code, x, y }: { code: FlagCode; x: number; y: number })`
  - `helmetArt.tsx`:
    - `helmetLift(model: HelmetModel, traps: number | null): number` = `(HELMET_NECK_Y − HELMET_NECK_PER_TRAP × max(0, traps ?? 0)) − (26 + (bottom − 26) × HELMET_SCALE)`
    - `helmetTransform(model, traps): string` = `translate(0 ${lift}) translate(50 26) scale(${HELMET_SCALE}) translate(-50 -26)`
    - `HelmetLayer(props: { id: string; model: HelmetModel; design: HelmetDesign; number: number; detail: boolean; decals: { flags: FlagCode[]; dot: boolean } | null })`, its root `<g className="helmet">`
    - `MaskLayer(props: { model: HelmetModel; mask: MaskKind; color: string })`

Port from the mockup (`MODELS`, `DECALS`, `MASK`, `CLIPS_STD`, `vents`, `slot`, `ledge`, `dots`, `HelmetLayer`,
`CageLayer` → `MaskLayer`, `Flag`, `Decals`). Settled values to keep:

| Item | Value |
| --- | --- |
| Shells | the mockup's `axiom`, `axiomLite`, `f7` (round-7 plate `M30 34 C40 33.3 60 33.3 70 34 L70 46 L30 46 Z`, number y 37.8 size 5.2), `veng` (bumper `M38.6 36.2 C44 35.4 56 35.4 61.4 36.2 L61 41.4 C55 42.6 45 42.6 39 41.4 Z`, number y 38.9 size 4.5), `zero2`, `zero2t` (`widen` 1.06), `ridge`, `oldmod`, renamed |
| Decal spots `{ fx, fy, dy }` | modern, modernSmooth, ridgeback 38 / 32 / 29.5; retro 38.2 / 32 / 30; plated 38.2 / 28.4 / 31; classic 38.6 / 29.7 / 33.5; pod 38.6 / 29.2 / 31.5; podWide 38.2 / 28.8 / 31.1; the dot at x 50 |
| Flags | stacked, the US flag on top, `FLAG_GAP` apart; a single flag centred in the two-flag box |
| Green dot | r 1.05, `#22B14C`, a 0.3 dark edge, a small highlight |
| Clips | the black clip with a white tip (`CLIPS_STD`, the mockup's `clips` per shell) |
| Dark shells | `isDarkShell(shell)`: a rim stroke `tint(shell, 0.6)` at 0.55 opacity, gloss 0.72, vents edged |
| `detail: false` | shell, stripes, plate or bumper and outline only: no vents, clips, number or decals |

- [ ] **Step 1: Write the failing tests** in `src/ui/helmetArt.test.tsx` (render inside `<svg>` to markup):

```ts
it('draws every shell, plain or detailed, with no NaN', () => {
  for (const model of Object.keys(HELMET_LABEL) as HelmetModel[])
    for (const detail of [false, true]) {
      const svg = render({ model, design: KC_DESIGN, detail, decals: null });
      expect(svg).toContain('class="helmet"');
      expect(svg).not.toContain('NaN');
      if (!detail) expect(svg).not.toContain('#16181c'); // no clips on a list-size helmet
    }
});
it('stacks the flags and adds the green dot only when asked', () => {
  const one = render({ model: 'modern', design: KC_DESIGN, detail: true, decals: { flags: ['US'], dot: false } });
  const two = render({ model: 'modern', design: KC_DESIGN, detail: true, decals: { flags: ['US', 'JP'], dot: true } });
  expect(one).toContain('#B22234'); expect(one).not.toContain('#BC002D'); expect(one).not.toContain('#22B14C');
  expect(two).toContain('#BC002D'); expect(two).toContain('#22B14C');
});
it('draws every flag', () => {
  for (const code of ['US', ...Object.values(PATHWAY_FLAGS)] as FlagCode[])
    expect(renderToStaticMarkup(<svg><Flag code={code} x={0} y={0} /></svg>), code).toMatch(/<rect|<circle|<path/);
});
it('rims a dark shell, and keeps an outline on a white one', () => {
  expect(render({ model: 'modern', design: { ...KC_DESIGN, shell: '#101820' }, detail: true, decals: null })).toContain(tint('#101820', 0.6));
  expect(render({ model: 'modern', design: { ...KC_DESIGN, shell: '#ffb612' }, detail: true, decals: null })).not.toContain(tint('#ffb612', 0.6));
  expect(render({ model: 'modern', design: { ...KC_DESIGN, shell: '#F2F4F6' }, detail: true, decals: null })).toContain('stroke="#0F172A"');
});
it('sets the bumper a little above the collar, higher on heavier builds', () => {
  expect(helmetLift('modern', 0)).toBeCloseTo(-1.48, 2);
  expect(helmetLift('modern', 3)).toBeCloseTo(-2.98, 2);
  expect(helmetLift('modern', -0.6)).toBeCloseTo(helmetLift('modern', 0), 5); // lean builds don't sit lower
});
it('draws the mask by kind, before the neck', () => {
  for (const mask of ['qb', 'skill', 'hybrid', 'line', 'kicker'] as const)
    expect(renderToStaticMarkup(<svg><MaskLayer model="modern" mask={mask} color="#9AA3AD" /></svg>)).toContain('#9AA3AD');
});
```

  (`KC_DESIGN` is Kansas City's seed design; `render` wraps `HelmetLayer` with `id="t"` and `number={12}`.)

- [ ] **Step 2: Run** `npx vitest run src/ui/helmetArt.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** the test file, `src/ui/helmet.test.ts` (the naming test now reads these files) and
  `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`Avatars: draw the helmet: eight shells, details, masks, flags and the green dot`).

---

### Task 6: The helmet on the avatar (`PlayerAvatar`)

**Files:**
- Modify: `src/ui/components.tsx` (`PlayerAvatar`, ~line 73)
- Test: `src/ui/avatar.test.tsx`

**Interfaces:**
- Consumes: Tasks 2 and 5 (`wearsHelmet`, `helmetModelOf`, `helmetDesignOf`, `maskOf`, `flagsOf`, `greenDotOf`,
  `helmetTransform`, `HelmetLayer`, `MaskLayer`); `buildOf` (`ui/playerLook.ts`).

- [ ] **Step 1: Write the failing tests** in `src/ui/avatar.test.tsx` (its `html`, `pearson` and `BLUE` helpers):

```ts
it('puts a helmet on a player with a club at every size, and keeps the bare head without one', () => {
  for (const size of [24, 32, 56, 96, 128]) {
    const svg = html(size);
    expect(svg).toContain('class="helmet"');
    expect(svg).not.toContain('NaN');
  }
  const bare = (p: Player, team: Team | null) => renderToStaticMarkup(<PlayerAvatar player={p} team={team} size={128} />);
  expect(bare({ ...pearson, teamId: null }, null)).not.toContain('class="helmet"');
  expect(bare({ ...pearson, retired: true }, BLUE)).not.toContain('class="helmet"');
  expect(bare({ ...pearson, teamId: null, scouting: {} } as unknown as Player, null)).not.toContain('class="helmet"');
  // drafted: his club's helmet from then on
  expect(bare({ ...pearson, teamId: 0, scouting: {}, draft: {} } as unknown as Player, BLUE)).toContain('class="helmet"');
});
it('keeps decals off small avatars and flies a Pathway flag on the card', () => {
  expect(html(32)).not.toContain('#B22234');
  expect(html(128)).toContain('#B22234');
  const japan = PATHWAY_ORIGINS.find((i) => ORIGINS[i].name === 'Japan')!;
  expect(html(128, { ...pearson, origin: japan })).toContain('#BC002D');
});
it("gives a club without a design its colours' helmet", () => {
  expect(html(128)).toContain('#1D4ED8'); // BLUE has no `helmet`: the fallback's shell
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/avatar.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Wire it in `PlayerAvatar`.** When `wearsHelmet(player, team)`:
  - `model = helmetModelOf(player)`, `design = helmetDesignOf(team)`, `traps = look.build ? buildOf(player.weightLb).traps : null`.
  - `<g transform={helmetTransform(model, traps)}><MaskLayer model={model} mask={maskOf(player.position)} color={design.mask} /></g>` just before the neck.
  - No ears or head; `<g transform={helmetTransform(model, traps)}><HelmetLayer … /></g>` after the collar line, before
    the sleeve bands.
  - `detail = size >= BUILD_MIN_PX` (32); decals from `DECALS_MIN_PX = 56`: `flags = flagsOf(player)`,
    `dot = league !== null && greenDotOf(league, team, player)` with `league = store.get()`.
  - A `player.portrait` still returns the `<img>` before any of this.

- [ ] **Step 4: Run** `npx vitest run src/ui/avatar.test.tsx src/ui/ui.test.ts src/ui/captainPatch.test.tsx` and
  `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Look at it.** Dump a league (`work/` is ignored):
  `mkdir -p work && npx tsx -e "const {createLeague}=require('./src/engine/generate'); require('node:fs').writeFileSync('work/helmets.json', JSON.stringify(createLeague({seed:'helmets'})))"`,
  then `npm run screens -- --save work/helmets.json --out work/shots --screens roster,card` and
  `npm run screens -- --save work/helmets.json --out work/shots-dark --screens roster,card --dark`. Check: helmets in
  the roster's small avatars, the card's helmet with flag and number, a dark club (PIT, CHI) reads, the tallest heavy
  lineman's crown at most tucks under the ring. Fix what's off before committing.

- [ ] **Step 6: Commit** (`Avatars: players wear their club's helmet`).

---

### Task 7: The gear editor (`PlayerCard.tsx`)

**Files:**
- Modify: `src/ui/screens/PlayerCard.tsx` (`GearEditor`, ~line 389, exported for its test; where it's rendered, ~line 320)
- Test: `src/ui/gearEditor.test.tsx` (new)

**Interfaces:**
- Consumes: `HELMET_LABEL`, `helmetModelOf` (Task 2); `Gear.helmet`, `Gear.wristband` (Task 1).

- [ ] **Step 1: Write the failing test** in `src/ui/gearEditor.test.tsx`:

```ts
it('offers the helmet, the padded sleeves and the wristband', () => {
  const html = renderToStaticMarkup(
    <GearEditor gear={{}} custom={false} ownHelmet="pod" onChange={() => {}} onReset={() => {}} />,
  );
  for (const text of ['Helmet', 'His own (Pod)', 'Pod, wide', 'Retro', 'Padded', 'Padded elbow', 'Wristband', 'Right wrist'])
    expect(html, text).toContain(text);
});
it('shows a picked helmet and band', () => {
  const html = renderToStaticMarkup(
    <GearEditor gear={{ helmet: 'classic', wristband: { side: 'right', color: 'white' } }} custom ownHelmet="pod" onChange={() => {}} onReset={() => {}} />,
  );
  expect(html).toMatch(/<option value="classic" selected/);
  expect(html).toMatch(/<option value="right" selected/);
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/gearEditor.test.tsx`. Expected: FAIL (`GearEditor` isn't exported, no rows).

- [ ] **Step 3: Add the rows.**
  - **Helmet**, the first row: a `GearSelect` whose options are `{ own: \`His own (${HELMET_LABEL[own]})\`, ...HELMET_LABEL }`
    with `own = helmetModelOf({ ...player, gear: undefined })` passed in as a new `ownHelmet: HelmetModel` prop; `own`
    deletes `gear.helmet`, any other value sets it.
  - **Sleeve** already lists the padded kinds (Task 3); their Arm list is the usual one.
  - **Wristband**, after Sleeve: `{ none: 'None', left: 'Left wrist', right: 'Right wrist' }`, and when set a Colour
    `GearSelect` with `COLOR_LABEL`.
  - "Back to his own" already drops the whole pick.

- [ ] **Step 4: Run** `npx vitest run src/ui/gearEditor.test.tsx src/ui/ui.test.ts` and `npm run typecheck`.
  Expected: PASS. (React renders a controlled `<select value>` as `selected` on the option; if the markup differs,
  match what `renderToStaticMarkup` gives for the existing Sleeve select.)

- [ ] **Step 5: Commit** (`Player card: pick a player's helmet and wristband`).

---

### Task 8: Docs, version and the branch

**Files:**
- Modify: `docs/AVATARS.md`, `src/ui/changelog.ts`, `package.json`

- [ ] **Step 1: `docs/AVATARS.md`.** Section 2: the head becomes the helmet. A new section "2d. Helmets" with the
  shells and their names, size and fit (`HELMET_SCALE`, `HELMET_NECK_Y`, `HELMET_NECK_PER_TRAP`), clips, masks by
  position, the club designs and fallback, dark shells, decals (flags, Pathway, the green dot). Section 2b: the padded
  sleeves and the wristband with their rates and the cold rule. Section 3: helmet at every size, details from 32px,
  decals from 56px. Section 6: the new tunables. Section 7: drop "Hair from behind (no helmet in the picture)" and the
  wristband line in 2c's "Dropped"; add alternate helmets (with alternate jerseys, primetime, fixed at scheduling), hair
  under the helmet, a SpeedFlex-style shell.

- [ ] **Step 2: Version.** `package.json` to the next PATCH (`0.2.37` unless main has moved on: one past main's) and a
  changelog entry, newest first, in a player's words (title "Helmets on", one paragraph: every player wears his club's
  helmet in one of eight shells, the flag and the green dot on the back, a Pathway player's country under the flag,
  quarterbacks' padded sleeves and play-call wristbands, and all of it pickable from the card's pencil).

- [ ] **Step 3: Verify.** `npm run format`, `npm run typecheck`, `npx vitest run src/ui src/engine/helmets.test.ts`
  (and `docs/AVATARS.md` read through once against the code's constant names).
  Expected: all pass.

- [ ] **Step 4: Commit and push** (`Avatars: helmets in the docs, 0.2.37`), then `git push -u origin
  claude/gallant-johnson-gqsz8w`. Open the pull request only when the owner asks; then read CI and fix what's red.
