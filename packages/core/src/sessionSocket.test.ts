import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionSocket } from './sessionSocket.js';

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

const getConfig = () => ({ url: 'wss://example.test', params: { api_key: 'k' } });

describe('createSessionSocket reconnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconnects with exponential backoff after an unexpected close', () => {
    const socket = createSessionSocket({
      getConfig,
      reconnectBaseDelayMs: 1000,
      maxReconnectAttempts: 3,
    });

    socket.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].simulateOpen();
    expect(socket.state).toBe('connected');

    // Connection drops unexpectedly.
    FakeWebSocket.instances[0].simulateUnexpectedClose();
    expect(socket.state).toBe('disconnected');

    // Not yet reconnected before the backoff delay elapses.
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Reconnects after the first backoff delay (1000ms).
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(socket.state).toBe('connecting');

    socket.destroy();
  });

  it('gives up after maxReconnectAttempts and lands in error state', () => {
    const socket = createSessionSocket({
      getConfig,
      reconnectBaseDelayMs: 100,
      maxReconnectAttempts: 2,
    });

    socket.start();
    FakeWebSocket.instances[0].simulateUnexpectedClose(); // attempt 1 scheduled
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].simulateUnexpectedClose(); // attempt 2 scheduled
    vi.advanceTimersByTime(200);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.instances[2].simulateUnexpectedClose(); // exhausted, should give up
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(socket.state).toBe('error');

    socket.destroy();
  });

  it('does not reconnect after destroy() is called', () => {
    const socket = createSessionSocket({ getConfig, reconnectBaseDelayMs: 100 });

    socket.start();
    FakeWebSocket.instances[0].simulateOpen();
    socket.destroy();

    // The close triggered by destroy() must not schedule a reconnect.
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('resets the backoff counter after a successful reconnect', () => {
    const socket = createSessionSocket({
      getConfig,
      reconnectBaseDelayMs: 100,
      maxReconnectAttempts: 2,
    });

    socket.start();
    FakeWebSocket.instances[0].simulateUnexpectedClose();
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second connection succeeds, resetting attempts back to 0.
    FakeWebSocket.instances[1].simulateOpen();
    FakeWebSocket.instances[1].simulateUnexpectedClose();

    // Backoff restarts from the base delay, not an already-exhausted counter.
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(3);

    socket.destroy();
  });
});
