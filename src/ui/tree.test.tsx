import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { liveTrees, mainMentor } from '../engine/trees';
import { CoachCard } from './screens/Coaches';

describe('the coach card’s tree', () => {
  const l = createLeague({ seed: 'tree-card' });
  const tree = liveTrees(l)[0];

  it('names who a disciple learned under', () => {
    const d = l.coaches[tree.activeHeadCoaches[0]];
    const m = mainMentor(l, d.id)!;
    const html = renderToStaticMarkup(<CoachCard league={l} coach={d} onClose={() => {}} />);
    expect(html).toContain('Coaching tree');
    expect(html).toContain(`${m.firstName} ${m.lastName}`);
  });

  it('shows a root’s tree in words, with no numbers from under the hood', () => {
    const root = l.coaches[tree.rootId] ?? l.retiredCoaches[tree.rootId];
    const html = renderToStaticMarkup(<CoachCard league={l} coach={root} onClose={() => {}} />);
    expect(html).toMatch(/tree/);
    expect(html).toMatch(/hottest tree|a respected tree|hasn’t produced a winner|great trees of its day/);
    for (const id of tree.disciples) expect(html).toContain(l.coaches[id]?.lastName ?? l.retiredCoaches[id].lastName);
  });

  it('says nothing for a coach with no links', () => {
    const inTrees = new Set(liveTrees(l).flatMap((t) => [t.rootId, ...t.disciples]));
    const loner = Object.values(l.coaches).find((c) => !inTrees.has(c.id) && !c.pastUnder?.length)!;
    const html = renderToStaticMarkup(<CoachCard league={l} coach={loner} onClose={() => {}} />);
    expect(html).not.toContain('Coaching tree');
  });
});
