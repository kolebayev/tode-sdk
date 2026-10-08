import { useState, useEffect, useRef, useCallback } from 'react';
import {
  tode,
  acquireSessionSocket,
  requestConfigFromPlugin,
  type SessionSocket,
  type TodeConfig,
  type TrackOptions,
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
  /** Track a simple action event (same as `tode.trackAction`; stable across renders) */
  trackAction: (actionName: string, options?: TrackOptions) => Promise<void>;
  /** Track an action with a numeric metric (same as `tode.trackActionWithMetric`; stable across renders) */
  trackActionWithMetric: (
    actionName: string,
    value: number,
    options?: TrackOptions
  ) => Promise<void>;
}

// Module-level so the hook hands out the same function identity on every render.
const trackAction: UseTodeReturn['trackAction'] = (actionName, options) =>
  tode.trackAction(actionName, options);
const trackActionWithMetric: UseTodeReturn['trackActionWithMetric'] = (actionName, value, options) =>
  tode.trackActionWithMetric(actionName, value, options);

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
 *   const { trackAction } = useTode();
 *
 *   const handleClick = () => {
 *     trackAction('button_clicked');
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

  // The socket outlives renders, so it reads the callback through a ref;
  // an inline arrow would otherwise stay frozen at its first-render version.
  const onStateChangeRef = useRef(onWebSocketStateChange);
  onStateChangeRef.current = onWebSocketStateChange;

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
    // One handle per instance; the connection itself is shared across the UI
    if (sessionSocketRef.current) return;

    const socket = acquireSessionSocket({
      debug,
      pingInterval,
      logPrefix: '[TODE:react]',
      getConfig: () => tode.getWebSocketConfig(),
      onStateChange: (state) => {
        setWsState(state);
        onStateChangeRef.current?.(state);
      },
    });
    sessionSocketRef.current = socket;
    socket.start();
  }, [debug, pingInterval]);

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
    // Ask for the config in case the plugin posted it before this listener existed
    requestConfigFromPlugin();

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

  return { tode, isReady, wsState, trackAction, trackActionWithMetric };
}
