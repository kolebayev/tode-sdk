import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NgZone } from '@angular/core';

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

const { TodeService } = await import('./tode.service.js');

// Real NgZone requires the zone.js polyfill; the service only calls run()/runOutsideAngular(),
// so a synchronous stub is enough for a unit test.
function fakeNgZone(): NgZone {
  return {
    run: (fn: () => unknown) => fn(),
    runOutsideAngular: (fn: () => unknown) => fn(),
  } as unknown as NgZone;
}

describe('TodeService WebSocket reconnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('automatically reconnects after an unexpected WebSocket close', async () => {
    const service = new TodeService(fakeNgZone());
    await vi.advanceTimersByTimeAsync(0); // flush the deferred initial-connection microtask

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateOpen();
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);

    service.ngOnDestroy();
  });

  it('stops reconnecting once ngOnDestroy runs', async () => {
    const service = new TodeService(fakeNgZone());
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    service.ngOnDestroy();

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('TodeService configure() ordering', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies debug:true from configure() to the very first connection attempt, even though tode was already ready at construction', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const service = new TodeService(fakeNgZone());
    // Mirrors real Angular usage: configure() runs synchronously right after
    // construction (e.g. from a component's ngOnInit), in the same tick.
    service.configure({ debug: true });

    // Let the deferred initial-connection check run.
    await Promise.resolve();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(logSpy).toHaveBeenCalledWith(
      '[TODE:angular] Connecting to WebSocket:',
      expect.any(String)
    );

    service.ngOnDestroy();
    logSpy.mockRestore();
  });
});
