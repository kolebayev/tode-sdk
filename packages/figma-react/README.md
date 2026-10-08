# @tode-sdk/figma-react

React hook for using Tode Analytics in a Figma plugin's UI (iframe).

```bash
npm install @tode-sdk/core @tode-sdk/figma-react
```

## Usage

```tsx
import { useTode } from '@tode-sdk/figma-react';

function App() {
  const { trackAction, isReady, wsState } = useTode({
    debug: false,
    pingInterval: 5000,
    onWebSocketStateChange: (state) => console.log('WS:', state),
  });

  return (
    <button onClick={() => trackAction('button_clicked')}>
      Click me
    </button>
  );
}
```

Requires `tode.init({ apiKey })` to have already run in the plugin controller (`code.ts`) - see the [docs](https://docs.usetode.dev).

## `useTode(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Log internal adapter activity to the console |
| `pingInterval` | `number` | `5000` | WebSocket keepalive ping interval, in ms |
| `onWebSocketStateChange` | `(state: WebSocketState) => void` | - | Called whenever the session WebSocket's state changes |

Returns `{ tode, isReady, wsState, trackAction, trackActionWithMetric }`. The two track functions delegate to `tode`, accept the same optional `TrackOptions` and keep their identity across renders. Components that call `useTode()` share one session WebSocket. The hook listens for the plugin controller's config message, opens the session WebSocket once ready, and automatically reconnects (exponential backoff) if the connection drops. Cleanup runs automatically on unmount - no manual `destroy()` call needed.
