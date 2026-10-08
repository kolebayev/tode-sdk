/**
 * Figma plugin API global declaration.
 * This allows TypeScript to recognize the `figma` global
 * without requiring @figma/plugin-typings in the bundle.
 */

interface FigmaUser {
  id: string;
  name?: string;
  photoUrl?: string;
}

interface FigmaUI {
  postMessage(message: unknown): void;
  onmessage: ((message: unknown) => void) | null;
  on?(type: 'message', callback: (message: unknown) => void): void;
  show(): void;
  hide(): void;
  close(): void;
}

interface Figma {
  currentUser: FigmaUser | null;
  pluginId: string;
  widgetId: string | null;
  editorType: string;
  mode: string;
  apiVersion: string;
  ui: FigmaUI;
  showUI(html: string, options?: { width?: number; height?: number }): void;
  closePlugin(message?: string): void;
}

declare const figma: Figma;
