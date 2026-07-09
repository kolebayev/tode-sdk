// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('todeStore SSR/non-browser safety', () => {
  it('does not throw when imported where `window` does not exist (e.g. SSR)', async () => {
    expect(typeof window).toBe('undefined');

    await expect(import('./todeStore.js')).resolves.toBeDefined();
  });
});
