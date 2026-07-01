/**
 * @tode-sdk/figma-angular - Tode Analytics SDK for Angular-based Figma plugins
 *
 * This package provides an Angular service for integrating Tode Analytics
 * into your Figma plugin's UI.
 *
 * @packageDocumentation
 */

export { TodeService, type TodeServiceConfig } from './tode.service.js';

// Re-export core types for convenience
export { tode, type TodeConfig, type WebSocketState } from '@tode-sdk/core';
