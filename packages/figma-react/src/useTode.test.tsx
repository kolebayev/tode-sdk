import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

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

// Imported after the mock so useTode picks up the mocked `tode`.
const { useTode } = await import('./useTode.js');

describe('useTode WebSocket reconnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('automatically reconnects after an unexpected WebSocket close', () => {
    renderHook(() => useTode());

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateOpen();

    FakeWebSocket.instances[0].simulateUnexpectedClose();

    // Default backoff base delay is 1000ms.
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stops reconnecting once the component unmounts', () => {
    const { unmount } = renderHook(() => useTode());

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateUnexpectedClose();

    unmount();

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
