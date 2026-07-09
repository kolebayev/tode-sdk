import { useState, useEffect, useRef, useCallback } from 'react';
import {
  tode,
  createSessionSocket,
  type SessionSocket,
  type TodeConfig,
  type WebSocketState,
} from '@tode-sdk/core';

/** Options for the useTode hook */
export interface UseTodeOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
  /** Callback when WebSocket state changes */
  onWebSocketStateChange?: (state: WebSocketState) => void;
}

/** Return type of the useTode hook */
export interface UseTodeReturn {
  /** The Tode instance with tracking methods */
  tode: typeof tode;
  /** Whether Tode has been initialized with config from plugin */
  isReady: boolean;
  /** Current WebSocket connection state */
  wsState: WebSocketState;
}

/**
 * React hook for using Tode Analytics in Figma plugin UI.
 *
 * This hook handles:
 * - Listening for configuration from the plugin controller
 * - Establishing WebSocket connection for session tracking
 * - Managing WebSocket lifecycle (ping/pong, reconnection)
 *
 * @param options - Optional configuration for the hook
 * @returns Object containing the tode instance and status flags
 *
 * @example Basic Usage
 * ```tsx
 * import { useTode } from '@tode-sdk/figma-react';
 *
 * function App() {
 *   const { tode, isReady } = useTode();
 *
 *   const handleClick = () => {
 *     if (isReady) {
 *       tode.trackAction('button_clicked');
 *     }
 *   };
 *
 *   return <button onClick={handleClick}>Track Click</button>;
 * }
 * ```
 *
 * @example With WebSocket State
 * ```tsx
 * import { useTode } from '@tode-sdk/figma-react';
 *
 * function App() {
 *   const { tode, isReady, wsState } = useTode({
 *     debug: true,
 *     onWebSocketStateChange: (state) => console.log('WS:', state),
 *   });
 *
 *   return (
 *     <div>
 *       <p>Ready: {isReady ? 'Yes' : 'No'}</p>
 *       <p>WebSocket: {wsState}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTode(options: UseTodeOptions = {}): UseTodeReturn {
  const { debug = false, pingInterval = 5000, onWebSocketStateChange } = options;

  // State for tracking readiness and WebSocket status
  const [isReady, setIsReady] = useState(tode.isReady);
  const [wsState, setWsState] = useState<WebSocketState>('disconnected');

  // Ref for the shared session WebSocket (connect/reconnect/ping lifecycle lives in core)
  const sessionSocketRef = useRef<SessionSocket | null>(null);

  /**
   * Log helper for debug mode.
   */
  const log = useCallback(
    (message: string, ...args: unknown[]) => {
      if (debug) {
        console.log(`[TODE:react] ${message}`, ...args);
      }
    },
    [debug]
  );

  /**
   * Initialize the session WebSocket connection (with automatic reconnect on drop).
   */
  const initWebSocket = useCallback(() => {
    // Prevent multiple connections
    if (sessionSocketRef.current) return;

    const socket = createSessionSocket({
      debug,
      pingInterval,
      logPrefix: '[TODE:react]',
      getConfig: () => tode.getWebSocketConfig(),
      onStateChange: (state) => {
        setWsState(state);
        onWebSocketStateChange?.(state);
      },
    });
    sessionSocketRef.current = socket;
    socket.start();
  }, [debug, pingInterval, onWebSocketStateChange]);

  /**
   * Clean up the session WebSocket connection.
   */
  const cleanupWebSocket = useCallback(() => {
    sessionSocketRef.current?.destroy();
    sessionSocketRef.current = null;
  }, []);

  /**
   * Handle messages from the plugin controller.
   */
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Figma wraps messages in pluginMessage
      const pluginMessage = event.data?.pluginMessage;
      if (!pluginMessage) return;

      const { type, message } = pluginMessage as { type?: string; message?: TodeConfig };

      if (type === 'TODE_DATA' && message) {
        log('Config received from plugin:', message);

        // Update the Tode instance
        tode.updateFromConfig(message);
        setIsReady(true);
      }
    };

    window.addEventListener('message', handleMessage);
    log('Message listener attached');

    return () => {
      window.removeEventListener('message', handleMessage);
      log('Message listener removed');
    };
  }, [log]);

  /**
   * Initialize WebSocket when ready.
   */
  useEffect(() => {
    if (isReady && !sessionSocketRef.current) {
      initWebSocket();
    }
  }, [isReady, initWebSocket]);

  /**
   * Cleanup on unmount.
   */
  useEffect(() => {
    return () => {
      cleanupWebSocket();
    };
  }, [cleanupWebSocket]);

  return { tode, isReady, wsState };
}
