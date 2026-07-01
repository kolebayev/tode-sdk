/**
 * @tode-sdk/figma-vue - Tode Analytics SDK for Vue-based Figma plugins
 *
 * This package provides a Vue composable for integrating Tode Analytics
 * into your Figma plugin's UI.
 *
 * @packageDocumentation
 */

export { useTode, type UseTodeOptions, type UseTodeReturn } from './useTode.js';

// Re-export core types for convenience
export { tode, type TodeConfig, type WebSocketState } from '@tode-sdk/core';
