# @tode-sdk/figma-svelte

Svelte store for using Tode Analytics in a Figma plugin's UI (iframe).

```bash
npm install @tode-sdk/core @tode-sdk/figma-svelte
```

## Usage

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { createTodeStore } from '@tode-sdk/figma-svelte';

  const todeStore = createTodeStore({ debug: false, pingInterval: 5000 });

  onDestroy(() => todeStore.destroy());
</script>

<button on:click={() => $todeStore.isReady && todeStore.trackAction('button_clicked')}>
  Click me
</button>
<p>Ready: {$todeStore.isReady}</p>
<p>WebSocket: {$todeStore.wsState}</p>
```

A pre-built default singleton is also available for quick use: `import { todeStore } from '@tode-sdk/figma-svelte'`. Prefer `createTodeStore()` if you need to call `destroy()` yourself or want non-default options.

Requires `tode.init({ apiKey })` to have already run in the plugin controller (`code.ts`) - see the [docs](https://docs.usetode.dev).

## `createTodeStore(config?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Log internal adapter activity to the console |
| `pingInterval` | `number` | `5000` | WebSocket keepalive ping interval, in ms |

Returns a Svelte store (`{ tode, isReady, wsState }` when read via `$store`) plus `trackAction`, `trackActionWithMetric`, and `destroy()`.

**Call `destroy()` yourself** (typically in `onDestroy`) to remove the store's message listener and close its WebSocket - Svelte has no lifecycle hook the store can use to clean up automatically the way the React/Vue/Angular adapters do. As a safety net, the store also closes itself on the page/iframe's `beforeunload` event if you forget, but that only helps once the page is already unloading - it doesn't substitute for calling `destroy()` when a component using the store is torn down without a full page unload.
