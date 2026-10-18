import { useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
/** Also read by the inline script in index.html, which applies the choice before the first paint. */
const KEY = 'afls-theme';

function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** Light, dark or the device's setting. A per-device choice, so it lives in localStorage, not the save. */
export function ThemeSelect() {
  const [theme, setTheme] = useState(savedTheme);
  const pick = (t: Theme) => {
    // styles.css keys both themes off data-theme; without it, prefers-color-scheme decides.
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      // Storage blocked (private mode, sandboxed host): the choice lasts until reload.
    }
    setTheme(t);
  };
  return (
    <label className="theme-select">
      Theme
      <select value={theme} onChange={(e) => pick(e.target.value as Theme)}>
        <option value="system">Device</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
