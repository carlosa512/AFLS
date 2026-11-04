import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the field engine', () => {
  it('keeps the field engine pure: no UI, DOM or Math.random', () => {
    const dir = new URL('.', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/from '[^']*\/ui\//);
      expect(src, f).not.toMatch(/Math\.random/);
      expect(src, f).not.toMatch(/\bdocument\.|\bwindow\./);
      expect(src, f).not.toMatch(/from 'react'/);
    }
  });
});
