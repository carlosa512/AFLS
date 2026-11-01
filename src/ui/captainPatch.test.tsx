import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import { nameCaptains } from '../engine/personality';
import { CaptainPatch, captainStreak, GOLD_AFTER, patchText } from './captainPatch';
import { isRookie, PlayerAvatar } from './components';

describe('captain patch', () => {
  const league = () => {
    const l = createLeague({ seed: 'patch' });
    nameCaptains(l);
    return l;
  };
  it('counts the seasons in a row he has been a captain, this one included', () => {
    const l = league();
    const p = l.players[l.teams[0].captains!.offense];
    expect(captainStreak(l, p)).toBe(1);
    p.captainSeasons = [l.season - 4, l.season - 2, l.season - 1, l.season];
    expect(captainStreak(l, p)).toBe(3);
    // not a captain this season: no patch, whatever his past
    const other = Object.values(l.players).find((x) => x.teamId === 0 && !x.captainSeasons)!;
    other.captainSeasons = [l.season - 2, l.season - 1];
    expect(captainStreak(l, other)).toBe(0);
  });
  it('lights a star a season and turns gold past the stars', () => {
    const colors = { primary: '#13294B', secondary: '#4B92DB' };
    const lit = (streak: number) =>
      (
        renderToStaticMarkup(<CaptainPatch streak={streak} colors={colors} background={colors.primary} />).match(
          /fill="#D9A93A"/g,
        ) ?? []
      ).length;
    expect(lit(1)).toBe(1);
    expect(lit(3)).toBe(3);
    // gold: the patch itself is the gold, its stars in ink
    expect(lit(GOLD_AFTER)).toBe(1);
    expect(patchText(3)).toBe('Captain · 3 seasons in a row');
  });
});

describe('rookies', () => {
  it('marks a first-year pro, never a prospect or a veteran', () => {
    const l = createLeague({ seed: 'rookies' });
    const all = Object.values(l.players);
    const rookie = all.find((p) => p.teamId !== null && p.experience === 0)!;
    const vet = all.find((p) => p.teamId !== null && p.experience > 0)!;
    expect(isRookie(rookie)).toBe(true);
    expect(isRookie(vet)).toBe(false);
    for (const p of all.filter((x) => x.scouting && !x.draft && x.teamId === null)) expect(isRookie(p)).toBe(false);
    const team = l.teams[rookie.teamId!];
    const mark = (p: typeof rookie, size: number) =>
      renderToStaticMarkup(<PlayerAvatar player={p} team={team} size={size} />).includes('#DC2626');
    expect(mark(rookie, 24)).toBe(true);
    expect(mark(rookie, 128)).toBe(true);
    expect(mark(vet, 128)).toBe(false);
  });
});
