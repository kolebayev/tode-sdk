import { Injectable, OnDestroy, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject, fromEvent } from 'rxjs';
import { takeUntil, filter, map } from 'rxjs/operators';
import {
  tode,
  createSessionSocket,
  type SessionSocket,
  type TodeConfig,
  type WebSocketState,
} from '@tode-sdk/core';

/** Configuration options for TodeService */
export interface TodeServiceConfig {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** WebSocket ping interval in ms (default: 5000) */
  pingInterval?: number;
}

/**
 * Angular service for using Tode Analytics in Figma plugin UI.
 *
 * This service handles:
 * - Listening for configuration from the plugin controller
 * - Establishing WebSocket connection for session tracking
 * - Managing WebSocket lifecycle (ping/pong, reconnection)
 * - Providing reactive observables for state changes
 *
 * @example Basic Usage
 * ```typescript
 * import { Component } from '@angular/core';
 * import { TodeService } from '@tode-sdk/figma-angular';
 *
 * @Component({
 *   selector: 'app-root',
 *   template: `
 *     <button (click)="trackClick()">Track Click</button>
 *   `
 * })
 * export class AppComponent {
 *   constructor(private todeService: TodeService) {}
 *
 *   trackClick() {
 *     if (this.todeService.isReady) {
 *       this.todeService.trackAction('button_clicked');
 *     }
 *   }
 * }
 * ```
 *
 * @example With Observables
 * ```typescript
 * import { Component, OnInit } from '@angular/core';
 * import { TodeService } from '@tode-sdk/figma-angular';
 *
 * @Component({
 *   selector: 'app-root',
 *   template: `
 *     <p>Ready: {{ isReady$ | async }}</p>
 *     <p>WebSocket: {{ wsState$ | async }}</p>
 *   `
 * })
 * export class AppComponent implements OnInit {
 *   isReady$ = this.todeService.isReady$;
 *   wsState$ = this.todeService.wsState$;
 *
 *   constructor(private todeService: TodeService) {}
 *
 *   ngOnInit() {
 *     this.todeService.configure({ debug: true });
 *   }
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class TodeService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly isReadySubject = new BehaviorSubject<boolean>(tode.isReady);
  private readonly wsStateSubject = new BehaviorSubject<WebSocketState>('disconnected');

  private sessionSocket: SessionSocket | null = null;
  private config: TodeServiceConfig = { debug: false, pingInterval: 5000 };

  /** Observable stream of ready state changes */
  readonly isReady$: Observable<boolean> = this.isReadySubject.asObservable();

  /** Observable stream of WebSocket state changes */
  readonly wsState$: Observable<WebSocketState> = this.wsStateSubject.asObservable();

  constructor(private ngZone: NgZone) {
    this.setupMessageListener();
  }

  /**
   * Configure the service options.
   * Should be called early in the app lifecycle.
   */
  configure(config: TodeServiceConfig): void {
    this.config = { ...this.config, ...config };
    this.log('Configured with:', this.config);
  }

  /** Current ready state (synchronous) */
  get isReady(): boolean {
    return this.isReadySubject.value;
  }

  /** Current WebSocket state (synchronous) */
  get wsState(): WebSocketState {
    return this.wsStateSubject.value;
  }

  /** Direct access to the Tode instance for tracking methods */
  get tode(): typeof tode {
    return tode;
  }

  /**
   * Track a simple action event.
   * Convenience method that delegates to tode.trackAction.
   */
  trackAction(actionName: string): Promise<void> {
    return tode.trackAction(actionName);
  }

  /**
   * Track an action with a numeric metric.
   * Convenience method that delegates to tode.trackActionWithMetric.
   */
  trackActionWithMetric(actionName: string, value: number): Promise<void> {
    return tode.trackActionWithMetric(actionName, value);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanupWebSocket();
    this.log('Service destroyed');
  }

  /**
   * Log helper for debug mode.
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[TODE:angular] ${message}`, ...args);
    }
  }

  /**
   * Set up listener for messages from the plugin controller.
   */
  private setupMessageListener(): void {
    // Use fromEvent for better Angular integration
    fromEvent<MessageEvent>(window, 'message')
      .pipe(
        takeUntil(this.destroy$),
        map((event) => event.data?.pluginMessage),
        filter((pluginMessage): pluginMessage is { type: string; message: TodeConfig } =>
          pluginMessage?.type === 'TODE_DATA' && pluginMessage?.message != null
        )
      )
      .subscribe((pluginMessage) => {
        this.ngZone.run(() => {
          this.log('Config received from plugin:', pluginMessage.message);

          // Update the Tode instance
          tode.updateFromConfig(pluginMessage.message);
          this.isReadySubject.next(true);

          // Initialize WebSocket after receiving config
          this.initWebSocket();
        });
      });

    this.log('Message listener attached');

    // Check if already ready. Deferred to a microtask so that a `configure()`
    // call made synchronously right after construction (e.g. from a
    // component's ngOnInit, the typical usage pattern) is guaranteed to run
    // first - otherwise the very first connection attempt could start with
    // stale defaults before configure() ever executes.
    if (tode.isReady) {
      queueMicrotask(() => {
        this.isReadySubject.next(true);
        this.initWebSocket();
      });
    }
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
    // Prevent multiple connections
    if (this.sessionSocket) return;

    // Run outside Angular zone to avoid unnecessary change detection from ping/reconnect timers
    this.ngZone.runOutsideAngular(() => {
      this.sessionSocket = createSessionSocket({
        debug: this.config.debug,
        pingInterval: this.config.pingInterval,
        logPrefix: '[TODE:angular]',
        getConfig: () => tode.getWebSocketConfig(),
        onStateChange: (state) => this.ngZone.run(() => this.wsStateSubject.next(state)),
      });
      this.sessionSocket.start();
    });
  }
}
