/**
 * @tode-sdk/figma-vanilla - Tode Analytics SDK for vanilla JS/TS Figma plugins
 *
 * This package provides a framework-agnostic client for integrating
 * Tode Analytics into your Figma plugin's UI.
 *
 * @packageDocumentation
 */

export {
  TodeClient,
  type TodeClientConfig,
  type TodeClientEventType,
  type TodeClientEvents,
  type TodeClientListener,
} from './TodeClient.js';

// Re-export core types for convenience
export { tode, type TodeConfig, type WebSocketState } from '@tode-sdk/core';
