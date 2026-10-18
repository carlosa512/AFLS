import { afterEach } from 'vitest';

// Engine tests are long synchronous simulations, and a file's tests run back to back without a turn of
// the event loop. Handing it back after each one lets the worker answer the runner, whose progress calls
// time out after 60 s without a reply (a file of multi-season tests can run longer than that).
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
