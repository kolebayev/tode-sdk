import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  simulateUnexpectedClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

vi.mock('@tode-sdk/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tode-sdk/core')>();
  return {
    ...actual,
    tode: {
      isReady: true,
      getWebSocketConfig: () => ({ url: 'wss://example.test', params: { api_key: 'k' } }),
      updateFromConfig: vi.fn(),
      trackAction: vi.fn(),
      trackActionWithMetric: vi.fn(),
    },
  };
});

const { resetSessionSocket } = await import('@tode-sdk/core');
const { TodeClient } = await import('./TodeClient.js');

describe('TodeClient WebSocket reconnection', () => {
  beforeEach(() => {
    resetSessionSocket();
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('automatically reconnects after an unexpected WebSocket close', async () => {
    const client = new TodeClient();
    await Promise.resolve(); // auto-start runs one microtask after construction

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateOpen();
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);

    client.destroy();
  });

  it('stops reconnecting once destroy() is called', async () => {
    const client = new TodeClient();
    await Promise.resolve();

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    client.destroy();

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('TodeClient safety-net cleanup', () => {
  beforeEach(() => {
    resetSessionSocket();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('destroys itself automatically when the page/iframe unloads without an explicit destroy() call', async () => {
    new TodeClient();
    await Promise.resolve();

    window.dispatchEvent(new Event('beforeunload'));

    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });
});

describe('TodeClient events and options', () => {
  beforeEach(() => {
    resetSessionSocket();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers 'ready' and the first wsStateChange to listeners added right after construction", async () => {
    const client = new TodeClient();
    const onReady = vi.fn();
    const onWsState = vi.fn();
    client.on('ready', onReady);
    client.on('wsStateChange', onWsState);

    await Promise.resolve();

    expect(onReady).toHaveBeenCalledWith(true);
    expect(onWsState).toHaveBeenCalledWith('connecting');

    client.destroy();
  });

  it('does not start when destroyed before the deferred auto-start runs', async () => {
    const client = new TodeClient();
    client.destroy();

    await Promise.resolve();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('asks the plugin controller for the config once it is listening', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage');

    const client = new TodeClient();
    await Promise.resolve();

    expect(postSpy).toHaveBeenCalledWith(
      { pluginMessage: { type: 'TODE_UI_READY' }, pluginId: '*' },
      '*'
    );

    client.destroy();
    postSpy.mockRestore();
  });

  it('passes track options through to tode', async () => {
    const { tode } = await import('@tode-sdk/core');
    const client = new TodeClient({ autoStart: false });
    const options = { eventSource: 'plugin' as const };

    client.trackAction('a', options);
    client.trackActionWithMetric('b', 2, options);

    expect(tode.trackAction).toHaveBeenCalledWith('a', options);
    expect(tode.trackActionWithMetric).toHaveBeenCalledWith('b', 2, options);
  });
});
