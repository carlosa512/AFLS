import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GearEditor } from './screens/PlayerCard';

const noop = () => {};

describe('GearEditor', () => {
  it('offers the helmet, the padded sleeves and the wristband', () => {
    const html = renderToStaticMarkup(
      <GearEditor gear={{}} custom={false} ownHelmet="pod" onChange={noop} onReset={noop} />,
    );
    for (const text of ['Helmet', 'His own (Pod)', 'Pod, wide', 'Retro', 'Padded', 'Padded elbow', 'Wristband'])
      expect(html, text).toContain(text);
  });
  it('shows a picked helmet and band', () => {
    const html = renderToStaticMarkup(
      <GearEditor
        gear={{ helmet: 'classic', wristband: { side: 'right', color: 'white' } }}
        custom
        ownHelmet="pod"
        onChange={noop}
        onReset={noop}
      />,
    );
    expect(html).toMatch(/<option value="classic" selected/);
    expect(html).toMatch(/<option value="right" selected/);
    expect(html).toContain('Right wrist');
  });
});
