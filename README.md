# Tode Analytics SDK

Analytics SDK for Figma plugins. Track user actions, session duration, and metrics in your Figma plugins.

Website: [usetode.dev](https://usetode.dev) · Docs: [docs.usetode.dev](https://docs.usetode.dev) · Dashboard: [app.usetode.dev](https://app.usetode.dev)

## Packages

| Package | Description |
|---------|-------------|
| [`@tode-sdk/core`](./packages/core) | Core SDK - types and Tode class |
| [`@tode-sdk/figma-react`](./packages/figma-react) | React hook for Figma plugin UI |
| [`@tode-sdk/figma-vue`](./packages/figma-vue) | Vue composable for Figma plugin UI |
| [`@tode-sdk/figma-angular`](./packages/figma-angular) | Angular service for Figma plugin UI |
| [`@tode-sdk/figma-svelte`](./packages/figma-svelte) | Svelte store for Figma plugin UI |
| [`@tode-sdk/figma-vanilla`](./packages/figma-vanilla) | Vanilla JS/TS client for Figma plugin UI |

## Quick Start

### 1. Install packages

```bash
# For React plugins
npm install @tode-sdk/core @tode-sdk/figma-react

# For Vue plugins
npm install @tode-sdk/core @tode-sdk/figma-vue

# For Angular plugins
npm install @tode-sdk/core @tode-sdk/figma-angular

# For Svelte plugins
npm install @tode-sdk/core @tode-sdk/figma-svelte

# For vanilla JS/TS plugins
npm install @tode-sdk/core @tode-sdk/figma-vanilla
```

### 2. Initialize in plugin controller (code.ts)

```typescript
import { tode } from '@tode-sdk/core';

// Show UI first
figma.showUI(__html__);

// Initialize Tode with your API key
await tode.init({ apiKey: 'your-api-key' });

// Track actions from the controller
tode.trackAction('plugin_opened');
```

### 3. Use in plugin UI

#### React

```tsx
import { useTode } from '@tode-sdk/figma-react';

function App() {
  const { tode, isReady } = useTode();

  return (
    <button
      onClick={() => isReady && tode.trackAction('button_clicked')}
    >
      Click me
    </button>
  );
}
```

#### Vue

```vue
<script setup lang="ts">
import { useTode } from '@tode-sdk/figma-vue';

const { tode, isReady } = useTode();
</script>

<template>
  <button @click="isReady && tode.trackAction('button_clicked')">
    Click me
  </button>
</template>
```

#### Angular

```typescript
import { Component } from '@angular/core';
import { TodeService } from '@tode-sdk/figma-angular';

@Component({
  selector: 'app-root',
  template: `<button (click)="track()">Click me</button>`
})
export class AppComponent {
  constructor(private todeService: TodeService) {}

  track() {
    if (this.todeService.isReady) {
      this.todeService.trackAction('button_clicked');
    }
  }
}
```

#### Svelte

```svelte
<script>
  import { createTodeStore } from '@tode-sdk/figma-svelte';
  import { onDestroy } from 'svelte';

  const todeStore = createTodeStore();

  onDestroy(() => todeStore.destroy());
</script>

<button on:click={() => $todeStore.isReady && todeStore.trackAction('button_clicked')}>
  Click me
</button>
<p>Ready: {$todeStore.isReady}</p>
```

#### Vanilla JS/TS

```typescript
import { TodeClient } from '@tode-sdk/figma-vanilla';

const client = new TodeClient();

client.on('ready', () => {
  console.log('Tode ready!');
});

document.querySelector('#btn').addEventListener('click', () => {
  client.trackAction('button_clicked');
});
```

## API

### `tode.init(options)`

Call once from the plugin controller (`code.ts`), after `figma.showUI()`.

```typescript
await tode.init({
  apiKey: 'your-api-key',   // required
  apiUrl: 'https://...',    // optional, defaults to the Tode Analytics production API
  wsUrl: 'wss://...',       // optional, defaults to the Tode Analytics production WebSocket endpoint
  debug: true,               // optional, defaults to false - logs internal SDK activity to the console
  signal: abortController.signal, // optional, lets you cancel init() early (in addition to its built-in 10s timeout)
});
```

### Core Methods

```typescript
// Track a simple action
tode.trackAction('action_name');

// Track action with numeric metric
tode.trackActionWithMetric('items_exported', 42);

// Both accept an optional { signal } to cancel the request early
tode.trackAction('action_name', { signal: abortController.signal });
```

`actionName` must be a non-empty string - `trackAction`/`trackActionWithMetric` reject (log and no-op) `undefined`, non-strings, or empty strings, since plain-JS callers (no TypeScript) aren't type-checked at compile time.

`tode.version` reports the installed `@tode-sdk/core` version - useful when a plugin author reports a bug and you need to know which build they're on.

### Session Tracking

Session duration is tracked via a WebSocket opened by the UI adapter (`useTode`, `TodeService`, `createTodeStore`, or `TodeClient`) once `isReady` becomes true. The server records the session's duration from the socket's open-to-close time; `@tode-sdk/core` alone (with no adapter) never opens this socket, so plain `core` usage produces no session data.

Every adapter now automatically reconnects with exponential backoff if the connection drops unexpectedly (1s, 2s, 4s, ... up to 30s, 5 attempts by default before giving up and reporting `wsState: 'error'`). `wsState` cycles through `'disconnected' | 'connecting' | 'connected' | 'error'` as this happens - surface it in your UI if you want to show a live connection indicator.

### Error handling and limits

`trackAction()` / `trackActionWithMetric()` never throw or reject - a failed request (network error, invalid API key, rate limiting) is only reported via `console.error`, regardless of `debug`. There is currently no way to detect delivery failure programmatically from plugin code; watch the console during development.

In particular, if a plugin's manifest doesn't request Figma "identity" access (so `figma.currentUser` is `null`) or a GeoIP lookup fails, the SDK substitutes safe fallback values (`'unknown'` / `''`) rather than sending `null` - so events aren't silently rejected by the backend's required-field validation.

If a plan's event quota is exceeded, the backend responds with `429` and the SDK likewise only logs this to the console - there is no callback or return value to detect throttling from plugin code.

### Framework peer dependency versions

The declared `peerDependencies` floors (`svelte >=3.0.0`, `@angular/core >=14.0.0`) reflect the oldest APIs actually used by each adapter, but CI only builds and typechecks against the versions pinned in each package's `devDependencies` (currently Svelte `^5.19.0`, Angular `^19.1.4`). Older versions within the declared range aren't exercised by any automated test - if you're on an older framework version, verify manually.

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Build specific package
npm run build:core
npm run build:react
# etc.
```

## License

MIT
