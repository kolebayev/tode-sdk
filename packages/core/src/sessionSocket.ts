import { tode } from './tode.js';
import type { WebSocketState, WebSocketStateCallback } from './types.js';

/** Options for {@link createSessionSocket}. */
export interface SessionSocketOptions {
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Max automatic reconnect attempts after an unexpected close before giving up (default: 5) */
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
    maxReconnectAttempts = 5,
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
    log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);

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

    const queryString = new URLSearchParams(config.params).toString();
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
        console.error(`${logPrefix} WebSocket error:`, error);
        setState('error');
      };
    } catch (error) {
      console.error(`${logPrefix} Failed to create WebSocket:`, error);
      ws = null;
      scheduleReconnect();
    }
  };

  return {
    get state() {
      return state;
    },
    start() {
      connect();
    },
    destroy() {
      destroyed = true;
      clearReconnectTimer();
      clearPing();
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
