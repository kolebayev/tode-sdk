/**
 * @tode-sdk/core - Core Tode Analytics SDK
 *
 * This package provides the core functionality for tracking analytics
 * events in Figma plugins. It includes the main Tode class and all
 * shared types.
 *
 * @packageDocumentation
 */

// Export main Tode class and instance
export { tode, Tode, requestConfigFromPlugin, UI_READY_MESSAGE } from './tode.js';

// Export the SDK version
export { VERSION } from './version.js';

// Export shared session WebSocket helper used by framework adapters
export { createSessionSocket, acquireSessionSocket, resetSessionSocket } from './sessionSocket.js';
export type { SessionSocket, SessionSocketOptions } from './sessionSocket.js';

// Export all types
export type {
  AppSource,
  EventSource,
  EventType,
  FigmaEditorType,
  FigmaMode,
  FigmaData,
  TodeConfig,
  TodeInitOptions,
  TrackOptions,
  BaseEventPayload,
  ActionEventPayload,
  ActionWithMetricPayload,
  SessionPayload,
  TodeMessage,
  WebSocketState,
  WebSocketStateCallback,
  ITode,
} from './types.js';
