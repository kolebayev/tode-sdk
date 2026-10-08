# @tode-sdk/core

Core Tode Analytics SDK for Figma plugins - shared types and the `Tode` singleton class. Install this alongside a framework adapter (`@tode-sdk/figma-react`, `-vue`, `-angular`, `-svelte`, or `-vanilla`) for the plugin UI, or use it on its own from the plugin controller.

```bash
npm install @tode-sdk/core
```

## Usage

```typescript
// code.ts (plugin controller)
import { tode } from '@tode-sdk/core';

figma.showUI(__html__);
await tode.init({ apiKey: 'your-api-key' });

tode.trackAction('plugin_opened');
tode.trackActionWithMetric('items_exported', 42);
```

See the [docs](https://docs.usetode.dev) for `init()` options, error-handling behavior, and session tracking. Using `@tode-sdk/core` alone (no framework adapter) tracks actions/metrics but does **not** produce session data - that requires one of the UI adapters to open the WebSocket.

## Exports

- `tode` - the singleton `Tode` instance
- `Tode` - the class itself, for advanced/test usage (`Tode.resetInstance()`)
- `acquireSessionSocket` - a handle on the one session WebSocket shared across the UI; what the adapters use
- `createSessionSocket` - the framework-agnostic WebSocket session helper (ping keepalive + exponential-backoff reconnect) underneath it; reach for either only if you're writing a new adapter
- `requestConfigFromPlugin`, `UI_READY_MESSAGE` - ask the plugin controller to re-send the config; adapters call this for you
- `VERSION` - the installed package version as a string (also available as `tode.version`)
- Types: `TodeInitOptions`, `TodeConfig`, `TrackOptions`, `FigmaData`, `ActionEventPayload`, `ActionWithMetricPayload`, `SessionPayload`, `WebSocketState`, `ITode`, and more (all shipped in the package's type declarations)
