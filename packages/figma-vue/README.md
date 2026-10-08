# @tode-sdk/figma-vue

Vue 3 composable for using Tode Analytics in a Figma plugin's UI (iframe).

```bash
npm install @tode-sdk/core @tode-sdk/figma-vue
```

## Usage

```vue
<script setup lang="ts">
import { useTode } from '@tode-sdk/figma-vue';

const { trackAction, isReady, wsState } = useTode({
  debug: false,
  pingInterval: 5000,
  onWebSocketStateChange: (state) => console.log('WS:', state),
});
</script>

<template>
  <button @click="trackAction('button_clicked')">
    Click me
  </button>
</template>
```

Requires `tode.init({ apiKey })` to have already run in the plugin controller (`code.ts`) - see the [docs](https://docs.usetode.dev).

## `useTode(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Log internal adapter activity to the console |
| `pingInterval` | `number` | `5000` | WebSocket keepalive ping interval, in ms |
| `onWebSocketStateChange` | `(state: WebSocketState) => void` | - | Called whenever the session WebSocket's state changes |

Returns `{ tode, isReady, wsState, trackAction, trackActionWithMetric }` (`isReady`/`wsState` are readonly refs; the two track functions delegate to `tode` and accept the same optional `TrackOptions`). The composable listens for the plugin controller's config message, opens the session WebSocket once ready, and automatically reconnects (exponential backoff) if the connection drops. Cleanup runs automatically in `onUnmounted` - no manual `destroy()` call needed.
