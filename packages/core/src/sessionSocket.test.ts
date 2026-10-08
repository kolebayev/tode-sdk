import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireSessionSocket, createSessionSocket, resetSessionSocket } from './sessionSocket.js';

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

  it('keeps reconnecting by default, with the delay capped', () => {
    const socket = createSessionSocket({
      getConfig,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 400,
    });

    socket.start();
    for (let attempt = 1; attempt <= 20; attempt++) {
      FakeWebSocket.instances[attempt - 1].simulateUnexpectedClose();
      vi.advanceTimersByTime(400);
      expect(FakeWebSocket.instances).toHaveLength(attempt + 1);
    }
    expect(socket.state).toBe('connecting');

    socket.destroy();
  });

  it('sends the same session_id on every reconnect, and a different one per socket', () => {
    const idOf = (ws: FakeWebSocket) => new URL(ws.url).searchParams.get('session_id');
    const first = createSessionSocket({ getConfig, reconnectBaseDelayMs: 100 });
    const second = createSessionSocket({ getConfig });

    first.start();
    FakeWebSocket.instances[0].simulateUnexpectedClose();
    vi.advanceTimersByTime(100);
    second.start();

    expect(idOf(FakeWebSocket.instances[0])).toBeTruthy();
    expect(idOf(FakeWebSocket.instances[1])).toBe(idOf(FakeWebSocket.instances[0]));
    expect(idOf(FakeWebSocket.instances[2])).not.toBe(idOf(FakeWebSocket.instances[0]));

    first.destroy();
    second.destroy();
  });

  it('does not write a socket error to the console unless debug is on', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = createSessionSocket({ getConfig });

    socket.start();
    FakeWebSocket.instances[0].onerror?.({});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(socket.state).toBe('error');

    socket.destroy();
    errorSpy.mockRestore();
  });

  it('reconnects at once when the network comes back, even after giving up', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    const socket = createSessionSocket({
      getConfig,
      reconnectBaseDelayMs: 100,
      maxReconnectAttempts: 1,
    });

    socket.start();
    FakeWebSocket.instances[0].simulateUnexpectedClose();
    vi.advanceTimersByTime(100);
    FakeWebSocket.instances[1].simulateUnexpectedClose();
    expect(socket.state).toBe('error');

    listeners.get('online')?.();
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(socket.state).toBe('connecting');

    socket.destroy();
    expect(listeners.has('online')).toBe(false);
  });
});

describe('acquireSessionSocket (one connection per UI)', () => {
  beforeEach(() => {
    resetSessionSocket();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    resetSessionSocket();
    vi.unstubAllGlobals();
  });

  it('opens a single connection for several holders and closes it with the last one', () => {
    const first = acquireSessionSocket({ getConfig });
    const second = acquireSessionSocket({ getConfig });

    first.start();
    second.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    first.destroy();
    expect(FakeWebSocket.instances[0].readyState).not.toBe(FakeWebSocket.CLOSED);
    expect(second.state).toBe('connecting');

    second.destroy();
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('tells every holder about state changes, and a late holder the current state', () => {
    const firstStates: string[] = [];
    const lateStates: string[] = [];
    const first = acquireSessionSocket({ getConfig, onStateChange: (s) => firstStates.push(s) });
    first.start();
    FakeWebSocket.instances[0].simulateOpen();

    const late = acquireSessionSocket({ getConfig, onStateChange: (s) => lateStates.push(s) });
    late.start();
    expect(lateStates).toEqual(['connected']);

    FakeWebSocket.instances[0].simulateUnexpectedClose();
    expect(firstStates).toEqual(['connecting', 'connected', 'disconnected']);
    expect(lateStates).toEqual(['connected', 'disconnected']);

    first.destroy();
    late.destroy();
  });

  it('stops notifying a holder that has left', () => {
    const states: string[] = [];
    const leaving = acquireSessionSocket({ getConfig, onStateChange: (s) => states.push(s) });
    const staying = acquireSessionSocket({ getConfig });
    leaving.start();
    staying.start();

    leaving.destroy();
    FakeWebSocket.instances[0].simulateOpen();

    expect(states).toEqual(['connecting']);
    expect(leaving.state).toBe('disconnected');

    staying.destroy();
  });

  it('opens a fresh connection after everyone left', () => {
    const first = acquireSessionSocket({ getConfig });
    first.start();
    first.destroy();

    const second = acquireSessionSocket({ getConfig });
    second.start();

    expect(FakeWebSocket.instances).toHaveLength(2);
    second.destroy();
  });
});
