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
/** How many events tracked before Tode is ready are kept; later ones are dropped */
const MAX_QUEUED_EVENTS = 50;
/** Message the UI adapters post to the plugin controller to ask for the config */
export const UI_READY_MESSAGE = 'TODE_UI_READY';
/** Default timeout (ms) for outgoing API requests, so a hanging network call can't block init() forever */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * fetch() with a hard timeout, so a hanging request can't block a caller forever.
 * An optional caller-supplied `signal` is bridged into the internal timeout
 * controller so either one can cancel the request (kept manual, rather than
 * `AbortSignal.any`, for Node 18 compatibility).
 *
 * The Figma plugin sandbox (code.ts) has `fetch` but no `AbortController`, and
 * its `fetch` ignores `signal`. There the request can't be cancelled, so the
 * timeout only stops the caller from waiting on it.
 */
function fetchWithTimeout(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    const { signal: _signal, ...rest } = init;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([fetch(url, rest), timeout]).finally(() => clearTimeout(timer));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  });
}

/**
 * Build the error for a non-2xx response, keeping the API's own explanation
 * (`{ error, message }`) so a 403/429 in the console says which limit was hit.
 */
async function httpError(response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await response.json();
    if (typeof body?.message === 'string') detail = `: ${body.message}`;
  } catch {
    // Body is not JSON; the status alone has to do.
  }
  return new Error(`HTTP ${response.status}${detail}`);
}

/** An event as the caller tracked it; the payload is built when it is sent. */
interface TrackedEvent {
  type: 'action' | 'action_with_metric';
  actionName: string;
  actionValue?: number;
  timestamp: number;
  options?: TrackOptions;
}

/**
 * Ask the plugin controller to (re)send the Tode config. UI adapters call this
 * once their `message` listener is attached, so a config posted before the
 * listener existed, or lost when the plugin reopened its UI, is not lost for good.
 * No-op outside a browser.
 */
export function requestConfigFromPlugin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.parent.postMessage({ pluginMessage: { type: UI_READY_MESSAGE }, pluginId: '*' }, '*');
  } catch {
    // No reachable parent frame: nothing to ask.
  }
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
  private _queue: TrackedEvent[] = [];
  private _queueOverflowLogged = false;

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
        throw await httpError(response);
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

    try {
      figma.ui.postMessage({ type: 'TODE_DATA', message: config });
      this.log('Config sent to UI');
    } catch (error) {
      // A plugin without a UI has nobody to send the config to.
      this.log('Config not sent, no UI:', error);
    }
  }

  /**
   * Answer a UI adapter's request for the config. `figma.ui.on` adds a
   * listener next to the plugin's own `figma.ui.onmessage`, it does not
   * replace it.
   */
  private listenForUIReady(): void {
    try {
      figma.ui.on?.('message', (message: unknown) => {
        if ((message as { type?: unknown } | null)?.type !== UI_READY_MESSAGE) return;
        // Before init() finishes, the config it posts at the end is the answer.
        if (this._isReady) this.sendConfigToUI();
      });
    } catch (error) {
      this.log('Could not listen for UI messages:', error);
    }
  }

  /**
   * Build the base payload for tracking events.
   */
  private buildBasePayload(event: TrackedEvent) {
    return {
      actionName: event.actionName,
      timestamp: event.timestamp,
      appSource: this._appSource,
      eventSource: event.options?.eventSource ?? this._eventSource,
      userCountry: this._userCountry ?? 'unknown',
      ...this._figmaData,
      figma_userId: this._figmaData.figma_userId ?? '',
      figma_pluginId: this._figmaData.figma_pluginId ?? '',
    };
  }

  /**
   * Send an event now, or hold it until Tode is ready. Events tracked early
   * (typically the UI's first `trackAction` before the config arrives) keep
   * their original timestamp and are sent by `flushQueue()`.
   */
  private async dispatch(event: TrackedEvent): Promise<void> {
    if (this._isReady && this._apiKey) {
      await this.send(event);
      return;
    }

    if (this._queue.length >= MAX_QUEUED_EVENTS) {
      if (!this._queueOverflowLogged) {
        this._queueOverflowLogged = true;
        this.logError(
          `Tode is not ready and ${MAX_QUEUED_EVENTS} events are already waiting; dropping new events until it is`
        );
      }
      return;
    }

    this._queue.push(event);
    this.log(`${event.type}:${event.actionName} queued until ready`);
  }

  /**
   * Send everything tracked before Tode became ready.
   */
  private async flushQueue(): Promise<void> {
    if (this._queue.length === 0) return;

    const events = this._queue;
    this._queue = [];
    this._queueOverflowLogged = false;
    this.log(`Sending ${events.length} queued event(s)`);
    await Promise.all(events.map((event) => this.send(event)));
  }

  /**
   * Send one event to the API. Never rejects: failures are logged.
   */
  private async send(event: TrackedEvent): Promise<void> {
    const base = this.buildBasePayload(event);
    const payload: ActionEventPayload | ActionWithMetricPayload =
      event.type === 'action_with_metric'
        ? { type: 'action_with_metric', actionValue: event.actionValue as number, ...base }
        : { type: 'action', ...base };
    const endpoint =
      event.type === 'action_with_metric' ? '/figma/track-action-with-metric' : '/figma/track-action';

    try {
      const response = await fetchWithTimeout(`${this._apiUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this._apiKey as string,
        },
        body: JSON.stringify(payload),
        signal: event.options?.signal,
      });

      if (!response.ok) {
        throw await httpError(response);
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
   * data and sends configuration to the UI. Events tracked before it
   * finishes are sent once it does.
   *
   * Never throws: called outside the plugin controller (for example from
   * the UI) it logs an error and returns without initializing.
   *
   * @param options - Initialization options including API key
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

    // Registered before the first await so a UI that mounts meanwhile is heard
    this.listenForUIReady();

    // Fetch user country
    await this.fetchUserCountry(options.signal);

    // Send config to UI
    this.sendConfigToUI();

    this._isReady = true;
    this.log('Initialized successfully');

    await this.flushQueue();
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

    void this.flushQueue();
  }

  /**
   * Track a simple action event.
   *
   * Use this for tracking user interactions, feature usage, or any
   * event that doesn't require an associated numeric value.
   *
   * Safe to call before Tode is ready: the event is held (up to 50) and sent
   * with its original timestamp once the config arrives.
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

    await this.dispatch({ type: 'action', actionName, timestamp: Date.now(), options });
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

    await this.dispatch({
      type: 'action_with_metric',
      actionName,
      actionValue: value,
      timestamp: Date.now(),
      options,
    });
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
