/**
 * @tode-sdk/figma-svelte - Tode Analytics SDK for Svelte-based Figma plugins
 *
 * This package provides a Svelte store for integrating Tode Analytics
 * into your Figma plugin's UI.
 *
 * @packageDocumentation
 */

export {
  createTodeStore,
  todeStore,
  type TodeStoreConfig,
  type TodeStoreValue,
  type TodeStore,
} from './todeStore.js';

// Re-export core types for convenience
export { tode, type TodeConfig, type WebSocketState } from '@tode-sdk/core';
