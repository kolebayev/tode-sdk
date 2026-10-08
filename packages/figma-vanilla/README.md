# @tode-sdk/figma-vanilla

Framework-free JavaScript/TypeScript client for using Tode Analytics in a Figma plugin's UI (iframe).

```bash
npm install @tode-sdk/core @tode-sdk/figma-vanilla
```

## Usage

```typescript
import { TodeClient } from '@tode-sdk/figma-vanilla';

const client = new TodeClient({ debug: false, pingInterval: 5000 });

client.on('ready', (isReady) => {
  if (isReady) client.tode.trackAction('plugin_opened');
});

client.on('wsStateChange', (state) => {
  console.log('WebSocket:', state); // 'disconnected' | 'connecting' | 'connected' | 'error'
});

document.querySelector('#btn')?.addEventListener('click', () => {
  client.trackAction('button_clicked');
});

// When the plugin UI is closing:
client.destroy();
```

Requires `tode.init({ apiKey })` to have already run in the plugin controller (`code.ts`) - see the [docs](https://docs.usetode.dev).

## `new TodeClient(config?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Log internal adapter activity to the console |
| `pingInterval` | `number` | `5000` | WebSocket keepalive ping interval, in ms |
| `autoStart` | `boolean` | `true` | Start listening for the plugin controller's config message one microtask after construction, so `on()` listeners added right after `new TodeClient()` receive the first events. Set `false` to call `client.start()` manually later. |

| Member | Description |
|---|---|
| `on(event, listener)` / `off(event, listener)` | Subscribe/unsubscribe to `'ready'` (`boolean`) or `'wsStateChange'` (`WebSocketState`) events |
| `isReady` / `wsState` | Current state, read synchronously |
| `tode` | Direct access to the underlying `@tode-sdk/core` singleton |
| `trackAction(name, options?)` / `trackActionWithMetric(name, value, options?)` | Convenience delegates to `tode.trackAction` / `tode.trackActionWithMetric` |
| `start()` | Begin listening for plugin controller messages (no-op if already started or `autoStart` already did it) |
| `destroy()` | Remove listeners, close the WebSocket, and clear all event subscriptions |

**Call `destroy()` yourself** when the plugin UI is closing - there's no framework lifecycle hook to do this automatically. As a safety net, the client also destroys itself on the page/iframe's `beforeunload` event if you forget, but that only helps once the page is already unloading.
