import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

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

// Stub WebSocket before importing: the module's default singleton export
// (`export const todeStore = createTodeStore()`) connects eagerly at import
// time since the mocked `tode.isReady` above is already `true`.
vi.stubGlobal('WebSocket', FakeWebSocket);
const { resetSessionSocket } = await import('@tode-sdk/core');
const { createTodeStore } = await import('./todeStore.js');

describe('createTodeStore WebSocket reconnection', () => {
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

  it('automatically reconnects after an unexpected WebSocket close', () => {
    const store = createTodeStore();

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateOpen();
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(get(store).wsState).toBe('connecting');

    store.destroy();
  });

  it('stops reconnecting once destroy() is called', () => {
    const store = createTodeStore();

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    store.destroy();

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('createTodeStore safety-net cleanup', () => {
  beforeEach(() => {
    resetSessionSocket();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('destroys itself automatically when the page/iframe unloads without an explicit destroy() call', () => {
    createTodeStore();

    window.dispatchEvent(new Event('beforeunload'));

    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });
});
