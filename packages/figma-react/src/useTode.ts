import { useState, useEffect, useRef, useCallback } from 'react';
import { tode, type TodeConfig, type WebSocketState } from '@tode-sdk/core';

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

  // Refs for WebSocket management
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsInitializedRef = useRef(false);

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
   * Update WebSocket state and notify callback.
   */
  const updateWsState = useCallback(
    (state: WebSocketState) => {
      setWsState(state);
      onWebSocketStateChange?.(state);
    },
    [onWebSocketStateChange]
  );

  /**
   * Clean up WebSocket connection and ping interval.
   */
  const cleanupWebSocket = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  /**
   * Initialize WebSocket connection for session tracking.
   */
  const initWebSocket = useCallback(() => {
    // Prevent multiple connections
    if (wsInitializedRef.current || wsRef.current) return;

    const config = tode.getWebSocketConfig();
    if (!config) {
      log('WebSocket config not available');
      return;
    }

    wsInitializedRef.current = true;
    updateWsState('connecting');

    // Build WebSocket URL with query params
    const queryString = new URLSearchParams(config.params).toString();
    const wsUrl = `${config.url}?${queryString}`;

    log('Connecting to WebSocket:', config.url);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log('WebSocket connected');
        updateWsState('connected');

        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
            log('Ping sent');
          }
        }, pingInterval);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') {
          log('Pong received');
        }
      };

      ws.onclose = () => {
        log('WebSocket closed');
        updateWsState('disconnected');
        cleanupWebSocket();
      };

      ws.onerror = (error) => {
        console.error('[TODE:react] WebSocket error:', error);
        updateWsState('error');
      };
    } catch (error) {
      console.error('[TODE:react] Failed to create WebSocket:', error);
      updateWsState('error');
      wsInitializedRef.current = false;
    }
  }, [log, pingInterval, updateWsState, cleanupWebSocket]);

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
    if (isReady && !wsInitializedRef.current) {
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
