import {
  tode,
  acquireSessionSocket,
  requestConfigFromPlugin,
  type SessionSocket,
  type TodeConfig,
  type TrackOptions,
  type WebSocketState,
} from '@tode-sdk/core';

/** Event types emitted by TodeClient */
export type TodeClientEventType = 'ready' | 'wsStateChange';

/** Event payloads for TodeClient events */
export interface TodeClientEvents {
  ready: boolean;
  wsStateChange: WebSocketState;
}

/** Event listener callback type */
export type TodeClientListener<T extends TodeClientEventType> = (
  payload: TodeClientEvents[T]
) => void;

/** Configuration options for TodeClient */
export interface TodeClientConfig {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
  /** Auto-start listening for messages (default: true) */
  autoStart?: boolean;
}

/**
 * Vanilla JavaScript/TypeScript client for Tode Analytics in Figma plugin UI.
 *
 * This client handles:
 * - Listening for configuration from the plugin controller
 * - Establishing WebSocket connection for session tracking
 * - Managing WebSocket lifecycle (ping/pong)
 * - Event-based state notifications
 *
 * @example Basic Usage
 * ```typescript
 * import { TodeClient } from '@tode-sdk/figma-vanilla';
 *
 * const client = new TodeClient({ debug: true });
 *
 * client.on('ready', (isReady) => {
 *   if (isReady) {
 *     console.log('Tode is ready!');
 *     client.tode.trackAction('plugin_opened');
 *   }
 * });
 *
 * // Start listening for messages from plugin controller
 * client.start();
 *
 * // Clean up when done
 * // client.destroy();
 * ```
 *
 * @example With WebSocket State
 * ```typescript
 * import { TodeClient } from '@tode-sdk/figma-vanilla';
 *
 * const client = new TodeClient();
 *
 * client.on('wsStateChange', (state) => {
 *   console.log('WebSocket state:', state);
 *   // 'disconnected' | 'connecting' | 'connected' | 'error'
 * });
 *
 * client.start();
 * ```
 *
 * @example Manual Control
 * ```typescript
 * import { TodeClient } from '@tode-sdk/figma-vanilla';
 *
 * const client = new TodeClient({ autoStart: false });
 *
 * // Start manually when ready
 * document.addEventListener('DOMContentLoaded', () => {
 *   client.start();
 * });
 *
 * // Track actions
 * document.querySelector('#btn').addEventListener('click', () => {
 *   client.trackAction('button_clicked');
 * });
 * ```
 */
export class TodeClient {
  private config: Required<TodeClientConfig>;
  private listeners: Map<TodeClientEventType, Set<TodeClientListener<TodeClientEventType>>> =
    new Map();
  private sessionSocket: SessionSocket | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private beforeUnloadHandler: (() => void) | null = null;
  private _isReady = false;
  private _wsState: WebSocketState = 'disconnected';
  private _started = false;
  private _destroyed = false;

  /**
   * Create a new TodeClient instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config: TodeClientConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
      pingInterval: config.pingInterval ?? 5000,
      autoStart: config.autoStart ?? true,
    };

    // Initialize listener maps
    this.listeners.set('ready', new Set());
    this.listeners.set('wsStateChange', new Set());

    // Check if tode is already ready
    if (tode.isReady) {
      this._isReady = true;
    }

    // Auto-start if configured. Deferred one microtask so listeners added with
    // on() right after construction see the first 'ready' and 'wsStateChange'.
    if (this.config.autoStart) {
      queueMicrotask(() => {
        if (!this._destroyed) this.start();
      });
    }
  }

  /** Current ready state */
  get isReady(): boolean {
    return this._isReady;
  }

  /** Current WebSocket state */
  get wsState(): WebSocketState {
    return this._wsState;
  }

  /** Direct access to the Tode instance */
  get tode(): typeof tode {
    return tode;
  }

  /**
   * Start listening for messages from the plugin controller.
   * Called automatically, one microtask after construction, if autoStart is true (default).
   */
  start(): void {
    if (this._started) {
      this.log('Already started');
      return;
    }

    this._started = true;
    this.setupMessageListener();

    // Safety net: if the caller forgets to call destroy() explicitly, at
    // least stop pinging/reconnecting when the page/iframe unloads.
    if (typeof window !== 'undefined') {
      this.beforeUnloadHandler = () => this.destroy();
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }

    this.log('Started');

    // Already ready (the config arrived before this client existed)
    if (this._isReady) {
      this.emit('ready', true);
      this.initWebSocket();
    }
  }

  /**
   * Add an event listener.
   *
   * @param event - Event type to listen for
   * @param listener - Callback function
   */
  on<T extends TodeClientEventType>(event: T, listener: TodeClientListener<T>): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.add(listener as TodeClientListener<TodeClientEventType>);
    }
  }

  /**
   * Remove an event listener.
   *
   * @param event - Event type
   * @param listener - Callback function to remove
   */
  off<T extends TodeClientEventType>(event: T, listener: TodeClientListener<T>): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener as TodeClientListener<TodeClientEventType>);
    }
  }

  /**
   * Track a simple action event.
   * Convenience method that delegates to tode.trackAction.
   */
  trackAction(actionName: string, options?: TrackOptions): Promise<void> {
    return tode.trackAction(actionName, options);
  }

  /**
   * Track an action with a numeric metric.
   * Convenience method that delegates to tode.trackActionWithMetric.
   */
  trackActionWithMetric(actionName: string, value: number, options?: TrackOptions): Promise<void> {
    return tode.trackActionWithMetric(actionName, value, options);
  }

  /**
   * Clean up all resources (listeners, WebSocket, intervals).
   * Call this when the plugin UI is closing.
   */
  destroy(): void {
    this._destroyed = true;

    // Remove message listener
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }

    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    // Clean up WebSocket
    this.cleanupWebSocket();

    // Clear all listeners
    this.listeners.forEach((set) => set.clear());

    this._started = false;
    this.log('Destroyed');
  }

  /**
   * Log helper for debug mode.
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[TODE:vanilla] ${message}`, ...args);
    }
  }

  /**
   * Emit an event to all listeners.
   */
  private emit<T extends TodeClientEventType>(event: T, payload: TodeClientEvents[T]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          (listener as TodeClientListener<T>)(payload);
        } catch (error) {
          console.error(`[TODE:vanilla] Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Set up listener for messages from the plugin controller.
   */
  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      // Figma wraps messages in pluginMessage
      const pluginMessage = event.data?.pluginMessage;
      if (!pluginMessage) return;

      const { type, message } = pluginMessage as { type?: string; message?: TodeConfig };

      if (type === 'TODE_DATA' && message) {
        this.log('Config received from plugin:', message);

        // Update the Tode instance
        tode.updateFromConfig(message);
        // The config can arrive again (it is re-sent on request); 'ready' fires once
        if (!this._isReady) {
          this._isReady = true;
          this.emit('ready', true);
        }

        // Initialize WebSocket after receiving config
        this.initWebSocket();
      }
    };

    window.addEventListener('message', this.messageHandler);
    this.log('Message listener attached');
    // Ask for the config in case the plugin posted it before this listener existed
    requestConfigFromPlugin();
  }

  /**
   * Clean up the session WebSocket connection.
   */
  private cleanupWebSocket(): void {
    this.sessionSocket?.destroy();
    this.sessionSocket = null;
  }

  /**
   * Initialize the session WebSocket connection (with automatic reconnect on drop).
   */
  private initWebSocket(): void {
    // One handle per instance; the connection itself is shared across the UI
    if (this.sessionSocket) return;

    this.sessionSocket = acquireSessionSocket({
      debug: this.config.debug,
      pingInterval: this.config.pingInterval,
      logPrefix: '[TODE:vanilla]',
      getConfig: () => tode.getWebSocketConfig(),
      onStateChange: (state) => {
        this._wsState = state;
        this.emit('wsStateChange', state);
      },
    });
    this.sessionSocket.start();
  }
}
