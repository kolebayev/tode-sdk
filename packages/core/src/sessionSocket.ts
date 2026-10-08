import { tode } from './tode.js';
import type { WebSocketState, WebSocketStateCallback } from './types.js';

/** Options for {@link createSessionSocket}. */
export interface SessionSocketOptions {
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /**
   * Max automatic reconnect attempts after an unexpected close before giving up
   * and reporting `'error'` (default: no limit, since a plugin UI can stay open
   * through hours of laptop sleep)
   */
  maxReconnectAttempts?: number;
  /** Base delay in ms for exponential backoff between reconnect attempts (default: 1000) */
  reconnectBaseDelayMs?: number;
  /** Upper bound in ms for the backoff delay (default: 30000) */
  reconnectMaxDelayMs?: number;
  /** Called whenever the connection state changes */
  onStateChange?: WebSocketStateCallback;
  /** Prefix used in debug/error console output (default: '[TODE:core]') */
  logPrefix?: string;
  /** Supplies the WebSocket URL/params to connect with. Defaults to `tode.getWebSocketConfig()`. */
  getConfig?: () => { url: string; params: Record<string, string> } | null;
}

/** Handle returned by {@link createSessionSocket}. */
export interface SessionSocket {
  /** Current connection state */
  readonly state: WebSocketState;
  /** Open the connection (no-op if already connecting/connected) */
  start(): void;
  /** Close the connection and stop any pending reconnect attempts */
  destroy(): void;
}

/**
 * Framework-agnostic WebSocket session-tracking connection with ping keepalive
 * and exponential-backoff reconnection on unexpected disconnects.
 *
 * Shared by every `@tode-sdk/figma-*` adapter so the reconnect logic only
 * needs to be implemented once.
 */
export function createSessionSocket(options: SessionSocketOptions = {}): SessionSocket {
  const {
    pingInterval = 5000,
    debug = false,
    maxReconnectAttempts = Infinity,
    reconnectBaseDelayMs = 1000,
    reconnectMaxDelayMs = 30_000,
    onStateChange,
    logPrefix = '[TODE:core]',
    getConfig = () => tode.getWebSocketConfig(),
  } = options;

  let ws: WebSocket | null = null;
  let pingIntervalId: ReturnType<typeof setInterval> | null = null;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let destroyed = false;
  let state: WebSocketState = 'disconnected';
  // Stays the same across reconnects, so the rows they produce can be told
  // apart from separate sessions.
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  const log = (message: string, ...args: unknown[]) => {
    if (debug) console.log(`${logPrefix} ${message}`, ...args);
  };

  const setState = (next: WebSocketState) => {
    state = next;
    onStateChange?.(next);
  };

  const clearPing = () => {
    if (pingIntervalId) {
      clearInterval(pingIntervalId);
      pingIntervalId = null;
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  };

  const scheduleReconnect = () => {
    if (destroyed) return;

    if (reconnectAttempts >= maxReconnectAttempts) {
      log('Max reconnect attempts reached, giving up');
      setState('error');
      return;
    }

    const delay = Math.min(reconnectBaseDelayMs * 2 ** reconnectAttempts, reconnectMaxDelayMs);
    reconnectAttempts += 1;
    log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (destroyed || ws) return;

    const config = getConfig();
    if (!config) {
      log('WebSocket config not available');
      return;
    }

    setState('connecting');

    const queryString = new URLSearchParams({ ...config.params, session_id: sessionId }).toString();
    const wsUrl = `${config.url}?${queryString}`;
    log('Connecting to WebSocket:', config.url);

    try {
      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        log('WebSocket connected');
        reconnectAttempts = 0;
        setState('connected');

        pingIntervalId = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send('ping');
            log('Ping sent');
          }
        }, pingInterval);
      };

      socket.onmessage = (event) => {
        if (event.data === 'pong') log('Pong received');
      };

      socket.onclose = () => {
        log('WebSocket closed');
        clearPing();
        ws = null;
        setState('disconnected');
        scheduleReconnect();
      };

      socket.onerror = (error) => {
        // Debug only: the event carries no detail, and the close that follows reconnects.
        log('WebSocket error:', error);
        setState('error');
      };
    } catch (error) {
      console.error(`${logPrefix} Failed to create WebSocket:`, error);
      ws = null;
      scheduleReconnect();
    }
  };

  // Back online (network returned, laptop woke up): retry now instead of
  // waiting out the backoff, and resume if a finite attempt limit was used up.
  const onOnline = () => {
    if (destroyed || ws) return;
    log('Network is back, reconnecting');
    clearReconnectTimer();
    reconnectAttempts = 0;
    connect();
  };
  const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  let started = false;

  return {
    get state() {
      return state;
    },
    start() {
      if (!started && canListen) window.addEventListener('online', onOnline);
      started = true;
      connect();
    },
    destroy() {
      destroyed = true;
      if (canListen) window.removeEventListener('online', onOnline);
      clearReconnectTimer();
      clearPing();
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}

interface SharedSessionSocket {
  socket: SessionSocket;
  listeners: Set<WebSocketStateCallback>;
  holders: number;
  started: boolean;
}

let shared: SharedSessionSocket | null = null;

/**
 * Get a handle on the one session socket shared by everything in this UI.
 *
 * A plugin UI is one session however many components call `useTode()` (or
 * create a store or client), so they all hold the same connection instead of
 * opening one each. The connection opens on the first `start()` and closes
 * when the last holder calls `destroy()`.
 *
 * `pingInterval`, `debug`, `getConfig` and the reconnect settings come from
 * whoever acquires first; `onStateChange` is per holder.
 */
export function acquireSessionSocket(options: SessionSocketOptions = {}): SessionSocket {
  const { onStateChange, ...socketOptions } = options;

  if (!shared) {
    const listeners = new Set<WebSocketStateCallback>();
    shared = {
      listeners,
      holders: 0,
      started: false,
      socket: createSessionSocket({
        ...socketOptions,
        onStateChange: (state) => {
          listeners.forEach((listener) => {
            try {
              listener(state);
            } catch (error) {
              console.error('[TODE:core] Error in WebSocket state listener:', error);
            }
          });
        },
      }),
    };
  }

  const current = shared;
  current.holders += 1;
  let joined = false;
  let released = false;

  return {
    get state() {
      return released ? 'disconnected' : current.socket.state;
    },
    start() {
      if (released) return;
      if (!joined) {
        joined = true;
        if (onStateChange) current.listeners.add(onStateChange);
        // A holder that joins a live connection missed its earlier state changes.
        if (current.started && current.socket.state !== 'disconnected') {
          onStateChange?.(current.socket.state);
        }
      }
      current.started = true;
      current.socket.start();
    },
    destroy() {
      if (released) return;
      released = true;
      current.holders -= 1;

      if (current.holders > 0) {
        if (onStateChange) current.listeners.delete(onStateChange);
        return;
      }

      // Last holder: close the connection, letting it report the final state first.
      if (shared === current) shared = null;
      current.socket.destroy();
      current.listeners.clear();
    },
  };
}

/**
 * Close the shared session socket whatever is still holding it (useful for testing).
 * @internal
 */
export function resetSessionSocket(): void {
  const current = shared;
  shared = null;
  if (!current) return;
  current.listeners.clear();
  current.socket.destroy();
}
