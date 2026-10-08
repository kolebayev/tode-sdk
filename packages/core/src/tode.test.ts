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

describe('Tode in the Figma plugin sandbox (no AbortController)', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('still sends requests when AbortController does not exist', async () => {
    mockFigma();
    vi.stubGlobal('AbortController', undefined);
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, status: 200, json: async () => ({ country: 'DE' }) }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });
    await instance.trackAction('opened');

    expect(instance.userCountry).toBe('DE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('signal');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('stops waiting on a hung request after the timeout', async () => {
    mockFigma();
    vi.stubGlobal('AbortController', undefined);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const instance = Tode.getInstance();
    const done = instance.init({ apiKey: 'test-key' });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(instance.isReady).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch user country'),
      expect.objectContaining({ message: 'Timed out after 10000ms' })
    );
  });
});

describe('Tode error reporting', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs the API's own message for a rejected event", async () => {
    mockFigma();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/get-user-country')
          ? ({ ok: true, status: 200, json: async () => ({ country: 'DE' }) } as Response)
          : ({
              ok: false,
              status: 429,
              json: async () => ({
                error: 'events_limit_reached',
                message: 'Event quota for this billing period is used up',
              }),
            } as Response)
      )
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });
    await instance.trackAction('opened');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('action:opened failed'),
      expect.objectContaining({
        message: 'HTTP 429: Event quota for this billing period is used up',
      })
    );
  });
});

describe('Tode events tracked before ready', () => {
  const uiConfig = {
    appSource: 'figma' as const,
    userCountry: 'DE',
    eventSource: 'ui' as const,
    todeApiKey: 'test-key',
    todeAppUrl: 'https://api.test',
    todeWsUrl: 'wss://api.test',
    figmaData: {
      figma_userId: '42',
      figma_pluginId: 'plugin-123',
      figma_widgetId: null,
      figma_editorType: 'figma' as const,
      figma_mode: 'default' as const,
      figma_apiVersion: '1.0.0',
    },
  };
  const okFetch = () =>
    vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response
    );
  const bodies = (fetchMock: ReturnType<typeof okFetch>) =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(init?.body as string));

  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('holds a UI event until the config arrives, then sends it with its original timestamp', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const instance = Tode.getInstance();
    await instance.trackAction('plugin_opened');
    await instance.trackActionWithMetric('items', 3);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.setSystemTime(1_005_000);
    instance.updateFromConfig(uiConfig);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/figma/track-action',
      'https://api.test/figma/track-action-with-metric',
    ]);
    expect(bodies(fetchMock)).toEqual([
      expect.objectContaining({
        type: 'action',
        actionName: 'plugin_opened',
        timestamp: 1_000_000,
        eventSource: 'ui',
        userCountry: 'DE',
        figma_userId: '42',
      }),
      expect.objectContaining({ type: 'action_with_metric', actionValue: 3, timestamp: 1_000_000 }),
    ]);
    expect(errorSpy).not.toHaveBeenCalled();

    // A config that arrives again must not resend them.
    instance.updateFromConfig(uiConfig);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the first 50 events and drops the rest, reporting it once', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = Tode.getInstance();
    for (let i = 0; i < 60; i++) await instance.trackAction(`event_${i}`);
    instance.updateFromConfig(uiConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const names = bodies(fetchMock).map((body) => body.actionName);
    expect(names).toHaveLength(50);
    expect(names[0]).toBe('event_0');
    expect(names[49]).toBe('event_49');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('sends events tracked in the controller before init() once init() finishes', async () => {
    mockFigma();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const instance = Tode.getInstance();
    await instance.trackAction('early');
    await instance.init({ apiKey: 'test-key' });

    expect(bodies(fetchMock)).toEqual([
      expect.objectContaining({ actionName: 'early', eventSource: 'plugin' }),
    ]);
  });
});

describe('Tode config handshake with the UI', () => {
  beforeEach(() => {
    Tode.resetInstance();
  });

  afterEach(() => {
    delete (globalThis as any).figma;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockFigmaWithMessages() {
    const handlers: Array<(message: unknown) => void> = [];
    const postMessage = vi.fn();
    mockFigma({
      ui: { postMessage, on: (_type: 'message', cb: (message: unknown) => void) => handlers.push(cb) },
    } as unknown as Partial<Figma>);
    return { postMessage, deliver: (message: unknown) => handlers.forEach((cb) => cb(message)) };
  }

  it('re-sends the config when the UI says it is ready', async () => {
    const { postMessage, deliver } = mockFigmaWithMessages();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ country: 'DE' }) }) as Response)
    );

    const instance = Tode.getInstance();
    await instance.init({ apiKey: 'test-key' });
    expect(postMessage).toHaveBeenCalledTimes(1);

    deliver({ type: 'some_plugin_message' });
    deliver(null);
    expect(postMessage).toHaveBeenCalledTimes(1);

    deliver({ type: 'TODE_UI_READY' });
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0]).toEqual(postMessage.mock.calls[0][0]);
    expect(postMessage.mock.calls[1][0]).toMatchObject({
      type: 'TODE_DATA',
      message: { todeApiKey: 'test-key', userCountry: 'DE', eventSource: 'ui' },
    });
  });

  it('does not answer before init() has the country; the config posted at the end covers it', async () => {
    const { postMessage, deliver } = mockFigmaWithMessages();
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
    );

    const instance = Tode.getInstance();
    const done = instance.init({ apiKey: 'test-key' });
    deliver({ type: 'TODE_UI_READY' });
    expect(postMessage).not.toHaveBeenCalled();

    release({ ok: true, status: 200, json: async () => ({ country: 'DE' }) } as Response);
    await done;
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('initializes a plugin that has no UI', async () => {
    mockFigma({
      ui: {
        postMessage: () => {
          throw new Error('no UI');
        },
      },
    } as unknown as Partial<Figma>);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ country: 'DE' }) }) as Response)
    );

    const instance = Tode.getInstance();
    await expect(instance.init({ apiKey: 'test-key' })).resolves.toBeUndefined();
    expect(instance.isReady).toBe(true);
  });
});
