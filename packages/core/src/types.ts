/**
 * Supported application sources for analytics tracking.
 * Currently only 'figma' is supported, but designed for future extensibility.
 */
export type AppSource = 'figma';

/**
 * Origin of the tracked event - either from plugin controller or UI iframe.
 * - 'plugin': Event triggered from the Figma plugin controller (code.ts)
 * - 'ui': Event triggered from the plugin UI (iframe)
 */
export type EventSource = 'plugin' | 'ui';

/**
 * Types of trackable events.
 * - 'action': Simple action tracking (button clicks, feature usage)
 * - 'action_with_metric': Action with numeric value (counts, measurements)
 * - 'session': Session duration tracking via WebSocket
 */
export type EventType = 'action' | 'action_with_metric' | 'session';

/**
 * Figma editor types where the plugin can run.
 */
export type FigmaEditorType = 'figma' | 'figjam' | 'dev' | 'slides';

/**
 * Figma editor modes.
 */
export type FigmaMode = 'default' | 'codegen' | 'inspect' | 'textrun';

/**
 * Figma-specific data extracted from the plugin environment.
 * This data is only available when running inside Figma's plugin sandbox.
 */
export interface FigmaData {
  /** Current user's Figma ID */
  figma_userId: string | null;
  /** The plugin's unique identifier */
  figma_pluginId: string | null;
  /** The widget's unique identifier (for widget plugins) */
  figma_widgetId: string | null;
  /** Type of Figma editor (figma, figjam, dev, slides) */
  figma_editorType: FigmaEditorType | null;
  /** Current editor mode */
  figma_mode: FigmaMode | null;
  /** Figma API version */
  figma_apiVersion: string | null;
}

/**
 * Configuration passed from plugin controller to UI.
 * Sent via postMessage when Tode is initialized in the plugin.
 */
export interface TodeConfig {
  /** Application source identifier */
  appSource: AppSource;
  /** User's country code (ISO 3166-1 alpha-2) */
  userCountry: string | null;
  /** Event source identifier */
  eventSource: EventSource;
  /** API key for authentication */
  todeApiKey: string;
  /** HTTP API base URL */
  todeAppUrl: string;
  /** WebSocket URL for session tracking */
  todeWsUrl: string;
  /** Figma-specific data */
  figmaData: FigmaData;
}

/**
 * Base payload for all tracking events.
 */
export interface BaseEventPayload {
  /** Event type identifier */
  type: string;
  /** Name/identifier of the tracked action */
  actionName: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Application source */
  appSource: AppSource;
  /** Event origin (plugin/ui) */
  eventSource: EventSource;
  /** User's country code */
  userCountry: string | null;
}

/**
 * Payload for action tracking events.
 */
export interface ActionEventPayload extends BaseEventPayload, FigmaData {
  type: 'action';
}

/**
 * Payload for action with metric tracking events.
 */
export interface ActionWithMetricPayload extends BaseEventPayload, FigmaData {
  type: 'action_with_metric';
  /** Numeric value associated with the action */
  actionValue: number;
}

/**
 * Shape of a session tracking record as recorded by the backend.
 *
 * The SDK never constructs or sends this payload itself - session tracking
 * works by opening a WebSocket (see `Tode.getWebSocketConfig()`) and the
 * server computes `sessionDuration` from the connection's open-to-close
 * wall-clock time once the socket closes. This type only describes that
 * server-side shape for consumers reading session data back out.
 */
export interface SessionPayload extends BaseEventPayload, FigmaData {
  type: 'session';
  /** Session duration in seconds (set by the server when the connection closes) */
  sessionDuration?: number;
}

/**
 * Message structure for plugin-to-UI communication.
 */
export interface TodeMessage {
  type: 'TODE_DATA';
  message: TodeConfig;
}

/**
 * Initialization options for Tode.
 */
export interface TodeInitOptions {
  /** API key for authentication (required) */
  apiKey: string;
  /** Custom API URL (optional, defaults to production) */
  apiUrl?: string;
  /** Custom WebSocket URL (optional, defaults to production) */
  wsUrl?: string;
  /** Enable debug logging (optional, defaults to false) */
  debug?: boolean;
  /** Abort this init() call's in-flight requests early (in addition to the built-in timeout) */
  signal?: AbortSignal;
}

/**
 * Options for tracking actions.
 */
export interface TrackOptions {
  /** Override the event source for this specific event */
  eventSource?: EventSource;
  /** Abort this call's in-flight request early (in addition to the built-in timeout) */
  signal?: AbortSignal;
}

/**
 * WebSocket connection state.
 */
export type WebSocketState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Callback for WebSocket state changes.
 */
export type WebSocketStateCallback = (state: WebSocketState) => void;

/**
 * Tode instance interface for type-safe usage.
 */
export interface ITode {
  /** Whether Tode is ready to track events */
  readonly isReady: boolean;
  /** Current Figma data */
  readonly figmaData: FigmaData;
  /** User's country code */
  readonly userCountry: string | null;
  /** Current event source */
  readonly eventSource: EventSource;
  /** The installed @tode-sdk/core version */
  readonly version: string;

  /**
   * Initialize Tode in the plugin controller environment.
   * Must be called before any tracking methods.
   */
  init(options: TodeInitOptions): Promise<void>;

  /**
   * Update Tode with config received from plugin controller.
   * Called automatically by framework-specific hooks.
   */
  updateFromConfig(config: TodeConfig): void;

  /**
   * Track a simple action event.
   */
  trackAction(actionName: string, options?: TrackOptions): Promise<void>;

  /**
   * Track an action with an associated numeric metric.
   */
  trackActionWithMetric(actionName: string, value: number, options?: TrackOptions): Promise<void>;
}
