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
const { resetSessionSocket } = await import('@tode-sdk/core');
const { useTode } = await import('./useTode.js');

describe('useTode WebSocket reconnection', () => {
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

  it('calls the latest onWebSocketStateChange, not the one from the first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useTode({ onWebSocketStateChange: cb }), {
      initialProps: { cb: first },
    });
    first.mockClear();

    rerender({ cb: second });
    FakeWebSocket.instances[0].simulateOpen();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('connected');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('shares one connection between components and keeps it until the last unmounts', () => {
    const first = renderHook(() => useTode());
    const second = renderHook(() => useTode());

    expect(FakeWebSocket.instances).toHaveLength(1);

    first.unmount();
    expect(FakeWebSocket.instances[0].readyState).not.toBe(FakeWebSocket.CLOSED);

    second.unmount();
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('returns stable trackAction and trackActionWithMetric that pass through to tode', async () => {
    const { tode } = await import('@tode-sdk/core');
    const { result, rerender } = renderHook(() => useTode());
    const before = result.current.trackAction;
    rerender();
    const options = { eventSource: 'ui' as const };

    result.current.trackAction('export_clicked', options);
    result.current.trackActionWithMetric('items_exported', 3, options);

    expect(result.current.trackAction).toBe(before);
    expect(tode.trackAction).toHaveBeenCalledWith('export_clicked', options);
    expect(tode.trackActionWithMetric).toHaveBeenCalledWith('items_exported', 3, options);
  });
});
