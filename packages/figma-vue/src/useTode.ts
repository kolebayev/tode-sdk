import { ref, onMounted, onUnmounted, readonly, type Ref } from 'vue';
import {
  tode,
  createSessionSocket,
  type SessionSocket,
  type TodeConfig,
  type WebSocketState,
} from '@tode-sdk/core';

/** Options for the useTode composable */
export interface UseTodeOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
  /** Callback when WebSocket state changes */
  onWebSocketStateChange?: (state: WebSocketState) => void;
}

/** Return type of the useTode composable */
export interface UseTodeReturn {
  /** The Tode instance with tracking methods */
  tode: typeof tode;
  /** Whether Tode has been initialized with config from plugin */
  isReady: Readonly<Ref<boolean>>;
  /** Current WebSocket connection state */
  wsState: Readonly<Ref<WebSocketState>>;
}

/**
 * Vue composable for using Tode Analytics in Figma plugin UI.
 *
 * This composable handles:
 * - Listening for configuration from the plugin controller
 * - Establishing WebSocket connection for session tracking
 * - Managing WebSocket lifecycle (ping/pong, reconnection)
 *
 * @param options - Optional configuration for the composable
 * @returns Object containing the tode instance and reactive status refs
 *
 * @example Basic Usage
 * ```vue
 * <script setup lang="ts">
 * import { useTode } from '@tode-sdk/figma-vue';
 *
 * const { tode, isReady } = useTode();
 *
 * const handleClick = () => {
 *   if (isReady.value) {
 *     tode.trackAction('button_clicked');
 *   }
 * };
 * </script>
 *
 * <template>
 *   <button @click="handleClick">Track Click</button>
 * </template>
 * ```
 *
 * @example With WebSocket State
 * ```vue
 * <script setup lang="ts">
 * import { useTode } from '@tode-sdk/figma-vue';
 *
 * const { tode, isReady, wsState } = useTode({
 *   debug: true,
 *   onWebSocketStateChange: (state) => console.log('WS:', state),
 * });
 * </script>
 *
 * <template>
 *   <div>
 *     <p>Ready: {{ isReady ? 'Yes' : 'No' }}</p>
 *     <p>WebSocket: {{ wsState }}</p>
 *   </div>
 * </template>
 * ```
 */
export function useTode(options: UseTodeOptions = {}): UseTodeReturn {
  const { debug = false, pingInterval = 5000, onWebSocketStateChange } = options;

  // Reactive state
  const isReady = ref(tode.isReady);
  const wsState = ref<WebSocketState>('disconnected');

  // Session WebSocket handle (connect/reconnect/ping lifecycle lives in core)
  let sessionSocket: SessionSocket | null = null;

  /**
   * Log helper for debug mode.
   */
  const log = (message: string, ...args: unknown[]) => {
    if (debug) {
      console.log(`[TODE:vue] ${message}`, ...args);
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
      logPrefix: '[TODE:vue]',
      getConfig: () => tode.getWebSocketConfig(),
      onStateChange: (state) => {
        wsState.value = state;
        onWebSocketStateChange?.(state);
      },
    });
    sessionSocket.start();
  };

  /**
   * Handle messages from the plugin controller.
   */
  const handleMessage = (event: MessageEvent) => {
    // Figma wraps messages in pluginMessage
    const pluginMessage = event.data?.pluginMessage;
    if (!pluginMessage) return;

    const { type, message } = pluginMessage as { type?: string; message?: TodeConfig };

    if (type === 'TODE_DATA' && message) {
      log('Config received from plugin:', message);

      // Update the Tode instance
      tode.updateFromConfig(message);
      isReady.value = true;

      // Initialize WebSocket after receiving config
      initWebSocket();
    }
  };

  // Lifecycle hooks
  onMounted(() => {
    window.addEventListener('message', handleMessage);
    log('Message listener attached');

    // Check if already ready
    if (tode.isReady) {
      isReady.value = true;
      initWebSocket();
    }
  });

  onUnmounted(() => {
    window.removeEventListener('message', handleMessage);
    cleanupWebSocket();
    log('Cleaned up');
  });

  return {
    tode,
    isReady: readonly(isReady),
    wsState: readonly(wsState),
  };
}
