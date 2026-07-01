# Tode Analytics SDK

Analytics SDK for Figma plugins. Track user actions, session duration, and metrics in your Figma plugins.

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

### Core Methods

```typescript
// Track a simple action
tode.trackAction('action_name');

// Track action with numeric metric
tode.trackActionWithMetric('items_exported', 42);
```

### Session Tracking

Session duration is automatically tracked via WebSocket when using the UI adapters. The session starts when the UI loads and ends when it closes.

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
