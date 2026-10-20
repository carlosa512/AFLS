// Only the version string is bundled: Vite tree-shakes named imports from JSON.
import { version } from '../../package.json';

/** The game's version (`docs/VERSIONING.md`), shown on every screen so a tester's screenshot says which build it is. */
export const APP_VERSION = `v${version}`;
