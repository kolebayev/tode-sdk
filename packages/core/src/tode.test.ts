import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tode } from './tode.js';
import { VERSION } from './version.js';

describe('Tode version', () => {
  it('exposes the SDK version on the singleton instance', () => {
    expect(Tode.getInstance().version).toBe(VERSION);
  });
});

function mockFigma(overrides: Partial<Figma> = {}) {
  (globalThis as any).figma = {
    currentUser: null,
    pluginId: 'plugin-123',
    widgetId: null,
    editorType: 'figma',
    mode: 'design',
    apiVersion: '1.0.0',
    ui: { postMessage: vi.fn() },
    ...overrides,
  };
}

describe('Tode payload null fallbacks', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
  });

  it('sends "unknown" for userCountry and empty strings for missing figma ids instead of null', async () => {
    mockFigma({ currentUser: null });

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/get-user-country')) {
        // Simulate a GeoIP lookup miss (e.g. private IP / VPN).
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });
    await instance.trackAction('button_clicked');

    const trackCall = fetchMock.mock.calls.find(([url]) => url.includes('/figma/track-action'));
    expect(trackCall).toBeDefined();

    const body = JSON.parse(trackCall![1]!.body as string);
    expect(body.userCountry).toBe('unknown');
    expect(body.userCountry).not.toBeNull();
    expect(body.figma_userId).toBe('');
    expect(body.figma_userId).not.toBeNull();
  });
});

describe('Tode fetch timeout', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('aborts a hanging get-user-country request instead of blocking init() forever', async () => {
    mockFigma();
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const instance = Tode.getInstance();
    const initPromise = instance.init({ apiKey: 'test-key' });

    await vi.advanceTimersByTimeAsync(15_000);
    await initPromise;

    expect(instance.isReady).toBe(true);
    expect(instance.userCountry).toBeNull();
  });
});

describe('Tode actionName validation', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
  });

  it('rejects an empty actionName without sending a request', async () => {
    mockFigma();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });
    fetchMock.mockClear();

    await instance.trackAction('');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('trackAction: actionName must be a non-empty string')
    );
  });

  it('rejects a non-string actionName passed from plain JS callers without sending a request', async () => {
    mockFigma();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });
    fetchMock.mockClear();

    // @ts-expect-error intentionally wrong type, mirroring an untyped JS caller
    await instance.trackActionWithMetric(undefined, 42);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Tode caller-provided AbortSignal', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
  });

  it('aborts the underlying trackAction request as soon as the caller aborts, without waiting for the default timeout', async () => {
    mockFigma();

    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
      if (url.includes('/get-user-country')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ country: 'US' }) } as Response);
      }
      capturedSignal = opts?.signal;
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });

    const controller = new AbortController();
    const trackPromise = instance.trackAction('test_action', { signal: controller.signal });

    // Let the async trackAction body run far enough to issue the fetch call.
    await Promise.resolve();
    await Promise.resolve();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    controller.abort();
    await trackPromise;

    expect(capturedSignal!.aborted).toBe(true);
  });
});
