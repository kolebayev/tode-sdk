import type {
  AppSource,
  EventSource,
  FigmaData,
  TodeConfig,
  TodeInitOptions,
  TrackOptions,
  ActionEventPayload,
  ActionWithMetricPayload,
  ITode,
} from './types.js';
import { VERSION } from './version.js';

/** Default production API URL */
const DEFAULT_API_URL = 'https://processing.usetode.dev';
/** Default production WebSocket URL */
const DEFAULT_WS_URL = 'wss://processing.usetode.dev';
/** Default timeout (ms) for outgoing API requests, so a hanging network call can't block init() forever */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * fetch() with a hard timeout, so a hanging request can't block a caller forever.
 * An optional caller-supplied `signal` is bridged into the internal timeout
 * controller so either one can cancel the request (kept manual, rather than
 * `AbortSignal.any`, for Node 18 compatibility).
 */
function fetchWithTimeout(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  });
}

/**
 * Tode Analytics SDK - Core class for tracking plugin events.
 *
 * This class implements a singleton pattern to ensure consistent state
 * across the plugin lifecycle. It handles both plugin controller and UI
 * environments with automatic data synchronization.
 *
 * @example Plugin Controller (code.ts)
 * ```typescript
 * import { tode } from '@tode-sdk/core';
 *
 * figma.showUI(__html__);
 * await tode.init({ apiKey: 'your-api-key' });
 * tode.trackAction('plugin_opened');
 * ```
 *
 * @example UI with React
 * ```typescript
 * import { useTode } from '@tode-sdk/figma-react';
 *
 * function App() {
 *   const tode = useTode();
 *   // tode is ready when isReady is true
 * }
 * ```
 */
class Tode implements ITode {
  private static instance: Tode | null = null;

  private _isReady = false;
  private _debug = false;
  private _appSource: AppSource = 'figma';
  private _eventSource: EventSource = 'plugin';
  private _userCountry: string | null = null;
  private _apiUrl: string = DEFAULT_API_URL;
  private _wsUrl: string = DEFAULT_WS_URL;
  private _apiKey: string | null = null;

  private _figmaData: FigmaData = {
    figma_userId: null,
    figma_pluginId: null,
    figma_widgetId: null,
    figma_editorType: null,
    figma_mode: null,
    figma_apiVersion: null,
  };

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton Tode instance.
   * Creates a new instance if one doesn't exist.
   */
  static getInstance(): Tode {
    if (!Tode.instance) {
      Tode.instance = new Tode();
    }
    return Tode.instance;
  }

  /**
   * Reset the singleton instance (useful for testing).
   * @internal
   */
  static resetInstance(): void {
    Tode.instance = null;
  }

  // --- Public Getters ---

  get isReady(): boolean {
    return this._isReady;
  }

  get figmaData(): FigmaData {
    return { ...this._figmaData };
  }

  get userCountry(): string | null {
    return this._userCountry;
  }

  get eventSource(): EventSource {
    return this._eventSource;
  }

  get apiKey(): string | null {
    return this._apiKey;
  }

  get apiUrl(): string {
    return this._apiUrl;
  }

  get wsUrl(): string {
    return this._wsUrl;
  }

  /** The installed @tode-sdk/core version. Useful when reporting bugs. */
  get version(): string {
    return VERSION;
  }

  // --- Private Methods ---

  /**
   * Log a message if debug mode is enabled.
   */
  private log(message: string, ...args: unknown[]): void {
    if (this._debug) {
      console.log(`[TODE:${this._eventSource}] ${message}`, ...args);
    }
  }

  /**
   * Log an error message (always shown).
   */
  private logError(message: string, ...args: unknown[]): void {
    console.error(`[TODE:${this._eventSource}] ${message}`, ...args);
  }

  /**
   * Check if running in Figma plugin environment.
   */
  private isPluginEnvironment(): boolean {
    return typeof figma !== 'undefined';
  }

  /**
   * Check that an actionName is usable, guarding against untyped JS callers
   * passing `undefined`/non-strings/empty strings.
   */
  private isValidActionName(actionName: unknown): actionName is string {
    return typeof actionName === 'string' && actionName.trim().length > 0;
  }

  /**
   * Fetch user's country from the API using GeoIP.
   */
  private async fetchUserCountry(signal?: AbortSignal): Promise<void> {
    if (!this._apiKey) return;

    try {
      const response = await fetchWithTimeout(`${this._apiUrl}/get-user-country`, {
        headers: { 'X-API-Key': this._apiKey },
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this._userCountry = data.country ?? null;
      this.log('User country:', this._userCountry);
    } catch (error) {
      this.logError('Failed to fetch user country:', error);
      this._userCountry = null;
    }
  }

  /**
   * Send tracking data to the plugin UI via postMessage.
   */
  private sendConfigToUI(): void {
    if (!this.isPluginEnvironment()) return;

    const config: TodeConfig = {
      appSource: this._appSource,
      userCountry: this._userCountry,
      eventSource: 'ui',
      todeApiKey: this._apiKey!,
      todeAppUrl: this._apiUrl,
      todeWsUrl: this._wsUrl,
      figmaData: this._figmaData,
    };

    figma.ui.postMessage({ type: 'TODE_DATA', message: config });
    this.log('Config sent to UI');
  }

  /**
   * Build the base payload for tracking events.
   */
  private buildBasePayload(actionName: string, options?: TrackOptions) {
    return {
      actionName,
      timestamp: Date.now(),
      appSource: this._appSource,
      eventSource: options?.eventSource ?? this._eventSource,
      userCountry: this._userCountry ?? 'unknown',
      ...this._figmaData,
      figma_userId: this._figmaData.figma_userId ?? '',
      figma_pluginId: this._figmaData.figma_pluginId ?? '',
    };
  }

  /**
   * Send tracking data to the API.
   */
  private async sendTrackingData(
    endpoint: string,
    payload: ActionEventPayload | ActionWithMetricPayload,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this._apiKey) {
      this.logError('Cannot track: Tode not initialized');
      return;
    }

    try {
      const response = await fetchWithTimeout(`${this._apiUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this._apiKey,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.log(`${payload.type}:${payload.actionName} sent`, data);
    } catch (error) {
      this.logError(`${payload.type}:${payload.actionName} failed:`, error);
    }
  }

  // --- Public Methods ---

  /**
   * Initialize Tode in the plugin controller environment.
   *
   * This method must be called from the plugin's main code (code.ts),
   * where the `figma` global is available. It extracts Figma-specific
   * data and sends configuration to the UI.
   *
   * @param options - Initialization options including API key
   * @throws Error if called outside Figma plugin environment
   *
   * @example
   * ```typescript
   * import { tode } from '@tode-sdk/core';
   *
   * // In code.ts (plugin controller)
   * figma.showUI(__html__);
   * await tode.init({ apiKey: 'your-api-key' });
   * ```
   */
  async init(options: TodeInitOptions): Promise<void> {
    // Validate environment
    if (!this.isPluginEnvironment()) {
      this.logError('init() must be called in plugin environment');
      return;
    }

    // Prevent re-initialization
    if (this._isReady) {
      this.log('Already initialized, skipping');
      return;
    }

    // Apply options
    this._apiKey = options.apiKey;
    this._apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this._wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
    this._debug = options.debug ?? false;

    // Extract Figma data
    this._figmaData = {
      figma_userId: figma.currentUser?.id ?? null,
      figma_pluginId: figma.pluginId ?? null,
      figma_widgetId: figma.widgetId ?? null,
      figma_editorType: (figma.editorType as FigmaData['figma_editorType']) ?? null,
      figma_mode: (figma.mode as FigmaData['figma_mode']) ?? null,
      figma_apiVersion: figma.apiVersion ?? null,
    };

    // Fetch user country
    await this.fetchUserCountry(options.signal);

    // Send config to UI
    this.sendConfigToUI();

    this._isReady = true;
    this.log('Initialized successfully');
  }

  /**
   * Update Tode with configuration received from the plugin controller.
   *
   * This method is called automatically by framework-specific hooks
   * when they receive the TODE_DATA message. You typically don't need
   * to call this directly.
   *
   * @param config - Configuration received from plugin controller
   */
  updateFromConfig(config: TodeConfig): void {
    this._appSource = config.appSource;
    this._eventSource = config.eventSource;
    this._userCountry = config.userCountry;
    this._apiKey = config.todeApiKey;
    this._apiUrl = config.todeAppUrl;
    this._wsUrl = config.todeWsUrl;
    this._figmaData = config.figmaData;
    this._isReady = true;

    this.log('Updated from config');
  }

  /**
   * Track a simple action event.
   *
   * Use this for tracking user interactions, feature usage, or any
   * event that doesn't require an associated numeric value.
   *
   * @param actionName - Identifier for the action (e.g., 'button_clicked')
   * @param options - Optional tracking options
   *
   * @example
   * ```typescript
   * // Track a button click
   * tode.trackAction('export_button_clicked');
   *
   * // Track with custom event source
   * tode.trackAction('settings_opened', { eventSource: 'ui' });
   * ```
   */
  async trackAction(actionName: string, options?: TrackOptions): Promise<void> {
    if (!this.isValidActionName(actionName)) {
      this.logError(`trackAction: actionName must be a non-empty string, got ${typeof actionName}`);
      return;
    }

    const payload: ActionEventPayload = {
      type: 'action',
      ...this.buildBasePayload(actionName, options),
    };

    await this.sendTrackingData('/figma/track-action', payload, options?.signal);
  }

  /**
   * Track an action with an associated numeric metric.
   *
   * Use this when you need to track a value along with an action,
   * such as counts, measurements, or any numeric metric.
   *
   * @param actionName - Identifier for the action
   * @param value - Numeric value to track (must be a number)
   * @param options - Optional tracking options
   *
   * @example
   * ```typescript
   * // Track number of items exported
   * tode.trackActionWithMetric('items_exported', 42);
   *
   * // Track processing time
   * tode.trackActionWithMetric('processing_time_ms', 1523);
   * ```
   */
  async trackActionWithMetric(
    actionName: string,
    value: number,
    options?: TrackOptions
  ): Promise<void> {
    if (!this.isValidActionName(actionName)) {
      this.logError(
        `trackActionWithMetric: actionName must be a non-empty string, got ${typeof actionName}`
      );
      return;
    }

    if (typeof value !== 'number' || isNaN(value)) {
      this.logError(`trackActionWithMetric: value must be a number, got ${typeof value}`);
      return;
    }

    const payload: ActionWithMetricPayload = {
      type: 'action_with_metric',
      actionValue: value,
      ...this.buildBasePayload(actionName, options),
    };

    await this.sendTrackingData('/figma/track-action-with-metric', payload, options?.signal);
  }

  /**
   * Get configuration for establishing WebSocket connection.
   * Used by framework-specific hooks for session tracking.
   *
   * @returns Configuration object for WebSocket connection, or null if not ready
   * @internal
   */
  getWebSocketConfig(): { url: string; params: Record<string, string> } | null {
    if (!this._isReady || !this._apiKey) return null;

    const params: Record<string, string> = {
      api_key: this._apiKey,
      type: 'session',
      actionName: 'session',
      timestamp: String(Date.now()),
      appSource: this._appSource,
      eventSource: this._eventSource,
      userCountry: this._userCountry ?? 'unknown',
      figma_userId: this._figmaData.figma_userId ?? '',
      figma_pluginId: this._figmaData.figma_pluginId ?? '',
      figma_widgetId: this._figmaData.figma_widgetId ?? '',
    };

    if (this._figmaData.figma_editorType) {
      params.figma_editorType = this._figmaData.figma_editorType;
    }
    if (this._figmaData.figma_mode) {
      params.figma_mode = this._figmaData.figma_mode;
    }
    if (this._figmaData.figma_apiVersion) {
      params.figma_apiVersion = this._figmaData.figma_apiVersion;
    }

    return { url: this._wsUrl, params };
  }
}

/** Singleton Tode instance for direct usage */
export const tode = Tode.getInstance();

/** Export class for advanced use cases (testing, custom instances) */
export { Tode };
