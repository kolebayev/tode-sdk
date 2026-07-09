import { writable, derived, type Readable } from 'svelte/store';
import {
  tode,
  createSessionSocket,
  type SessionSocket,
  type TodeConfig,
  type WebSocketState,
} from '@tode-sdk/core';

/** Configuration options for createTodeStore */
export interface TodeStoreConfig {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
}

/** Store value type */
export interface TodeStoreValue {
  /** The Tode instance with tracking methods */
  tode: typeof tode;
  /** Whether Tode has been initialized with config from plugin */
  isReady: boolean;
  /** Current WebSocket connection state */
  wsState: WebSocketState;
}

/** Return type of createTodeStore */
export interface TodeStore extends Readable<TodeStoreValue> {
  /** Track a simple action event */
  trackAction: (actionName: string) => Promise<void>;
  /** Track an action with a numeric metric */
  trackActionWithMetric: (actionName: string, value: number) => Promise<void>;
  /** Clean up resources (call on component destroy) */
  destroy: () => void;
}

/**
 * Create a Svelte store for Tode Analytics in Figma plugin UI.
 *
 * This store handles:
 * - Listening for configuration from the plugin controller
 * - Establishing WebSocket connection for session tracking
 * - Managing WebSocket lifecycle (ping/pong)
 * - Providing reactive state via Svelte stores
 *
 * @param config - Optional configuration options
 * @returns A Svelte store with tode instance and status
 *
 * @example Basic Usage
 * ```svelte
 * <script>
 *   import { createTodeStore } from '@tode-sdk/figma-svelte';
 *
 *   const todeStore = createTodeStore();
 *
 *   function handleClick() {
 *     if ($todeStore.isReady) {
 *       todeStore.trackAction('button_clicked');
 *     }
 *   }
 * </script>
 *
 * <button on:click={handleClick}>Track Click</button>
 * <p>Ready: {$todeStore.isReady}</p>
 * <p>WebSocket: {$todeStore.wsState}</p>
 * ```
 *
 * @example With onMount/onDestroy
 * ```svelte
 * <script>
 *   import { onDestroy } from 'svelte';
 *   import { createTodeStore } from '@tode-sdk/figma-svelte';
 *
 *   const todeStore = createTodeStore({ debug: true });
 *
 *   onDestroy(() => {
 *     todeStore.destroy();
 *   });
 * </script>
 * ```
 */
export function createTodeStore(config: TodeStoreConfig = {}): TodeStore {
  const { debug = false, pingInterval = 5000 } = config;

  // Internal state stores
  const isReady = writable(tode.isReady);
  const wsState = writable<WebSocketState>('disconnected');

  // Session WebSocket handle (connect/reconnect/ping lifecycle lives in core)
  let sessionSocket: SessionSocket | null = null;
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let beforeUnloadHandler: (() => void) | null = null;

  /**
   * Log helper for debug mode.
   */
  const log = (message: string, ...args: unknown[]) => {
    if (debug) {
      console.log(`[TODE:svelte] ${message}`, ...args);
    }
  };

  /**
   * Clean up the session WebSocket connection.
   */
  const cleanupWebSocket = () => {
    sessionSocket?.destroy();
    sessionSocket = null;
  };

  /**
   * Initialize the session WebSocket connection (with automatic reconnect on drop).
   */
  const initWebSocket = () => {
    // Prevent multiple connections
    if (sessionSocket) return;

    sessionSocket = createSessionSocket({
      debug,
      pingInterval,
      logPrefix: '[TODE:svelte]',
      getConfig: () => tode.getWebSocketConfig(),
      onStateChange: (state) => wsState.set(state),
    });
    sessionSocket.start();
  };

  /**
   * Set up listener for messages from the plugin controller.
   * No-ops outside a browser environment (e.g. SSR), where `window` doesn't exist.
   */
  const setupMessageListener = () => {
    if (typeof window === 'undefined') return;

    messageHandler = (event: MessageEvent) => {
      // Figma wraps messages in pluginMessage
      const pluginMessage = event.data?.pluginMessage;
      if (!pluginMessage) return;

      const { type, message } = pluginMessage as { type?: string; message?: TodeConfig };

      if (type === 'TODE_DATA' && message) {
        log('Config received from plugin:', message);

        // Update the Tode instance
        tode.updateFromConfig(message);
        isReady.set(true);

        // Initialize WebSocket after receiving config
        initWebSocket();
      }
    };

    window.addEventListener('message', messageHandler);
    log('Message listener attached');

    // Safety net: if the caller forgets to call destroy() explicitly, at
    // least stop pinging/reconnecting when the page/iframe unloads.
    beforeUnloadHandler = () => destroy();
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // Check if already ready
    if (tode.isReady) {
      isReady.set(true);
      initWebSocket();
    }
  };

  /**
   * Clean up all resources (call on component destroy).
   */
  const destroy = () => {
    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
      messageHandler = null;
    }
    if (beforeUnloadHandler) {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadHandler = null;
    }
    cleanupWebSocket();
    log('Store destroyed');
  };

  // Initialize on creation
  setupMessageListener();

  // Create derived store combining all state
  const store = derived(
    [isReady, wsState],
    ([$isReady, $wsState]) => ({
      tode,
      isReady: $isReady,
      wsState: $wsState,
    })
  );

  // Return enhanced store with methods
  return {
    subscribe: store.subscribe,

    trackAction: (actionName: string) => tode.trackAction(actionName),

    trackActionWithMetric: (actionName: string, value: number) =>
      tode.trackActionWithMetric(actionName, value),

    destroy,
  };
}

/**
 * Simple Tode store instance for basic usage.
 * For more control, use createTodeStore() instead.
 *
 * @example
 * ```svelte
 * <script>
 *   import { todeStore } from '@tode-sdk/figma-svelte';
 *
 *   $: ready = $todeStore.isReady;
 * </script>
 * ```
 */
export const todeStore = createTodeStore();
