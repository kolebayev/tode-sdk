# Changelog

All notable changes to the `@tode-sdk/*` packages are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). All six packages share one version; releases are cut by tagging `v<version>`, which runs `.github/workflows/publish.yml`, or by hand with `npm run release`.

## [1.0.0] - 2026-10-07

First npm release. Default endpoints moved to `https://processing.usetode.dev` and `wss://processing.usetode.dev`, matching the `manifest.json` allow-list in the docs.

### Fixed

- **Silent event loss** (`core`): `trackAction`/`trackActionWithMetric` now send `'unknown'`/`''` instead of raw `null` for `userCountry`/`figma_userId`/`figma_pluginId` when unavailable (no Figma identity permission, failed GeoIP lookup). Previously the backend's required-field validation silently rejected these events with a 400 that the SDK never surfaced.
- **No reconnect on dropped session WebSocket** (all adapters): every adapter now automatically reconnects with exponential backoff (1s → 30s, 5 attempts by default) instead of leaving session tracking permanently dead for the rest of the UI session after any network blip.
- **Angular `configure()` race** (`figma-angular`): `TodeService`'s first connection attempt is now deferred one microtask, so a `configure({ debug, pingInterval })` call made synchronously after injection (the documented `ngOnInit` pattern) reliably applies before that first attempt begins.
- **Svelte SSR crash** (`figma-svelte`): the module-level `todeStore` singleton no longer throws when imported in a non-browser environment (e.g. SSR) where `window` doesn't exist.
- **Angular adapter unusable in AOT builds** (`figma-angular`): `TodeService` shipped with a bare `@Injectable` decorator, which needs `@angular/compiler` at runtime; a production (AOT) app failed with "needs to be compiled using the JIT compiler". The service now carries a precompiled `providedIn: 'root'` definition.
- **Requests from `code.ts` in the Figma sandbox** (`core`): the request timeout relied on `AbortController`, which the plugin sandbox does not provide. Without it the SDK now falls back to a plain timer, and `signal` is ignored there.
- **Stale `onWebSocketStateChange`** (`figma-react`): the hook kept calling the callback from the first render; it now always calls the latest one.
- **Type declarations under Node ESM resolution** (all packages): `exports` now points `import` at `.d.mts` and `require` at `.d.ts`.
- **Events tracked before the UI was ready were dropped** (`core`): `trackAction`/`trackActionWithMetric` called before the config arrived (typically the UI's first `plugin_opened`) logged "Tode not initialized" and discarded the event. Up to 50 such events are now held and sent with their original timestamps once Tode is ready, in the UI and in the controller.
- **Config sent to the UI only once** (`core`, all adapters): a UI whose listener attached after the plugin posted `TODE_DATA`, or one reopened with `figma.showUI()`, never became ready. Adapters now post `TODE_UI_READY` when they start listening and `init()` answers with the config.
- **Session tracking stopped for good after ~31s offline** (`core`): the session socket gave up after 5 reconnect attempts. It now retries without a limit (delay capped at 30s) and reconnects at once on the browser's `online` event. `maxReconnectAttempts` still sets a limit if you want one.
- **`init()` in a plugin without a UI** (`core`): a failing `figma.ui.postMessage` no longer rejects `init()`.
- **`TodeClient` events missed at startup** (`figma-vanilla`): `'ready'` was never emitted when Tode was already ready, and the first `wsStateChange` fired inside the constructor before `on()` could be called. Auto-start now runs one microtask after construction, and `'ready'` fires once.
- **One session per component instead of per UI** (`core`, all adapters): every `useTode()`, store or client opened its own WebSocket, so a UI with three components using Tode was counted as three sessions. They now share one connection (`acquireSessionSocket()`), closed when the last holder is gone.
- **Hung `init()` on a stalled network request** (`core`): all outgoing requests now have a 10s default timeout via `AbortController`, instead of blocking indefinitely.

### Added

- `createSessionSocket()` (`core`) - the shared WebSocket session-tracking helper (ping keepalive + reconnect) every adapter is now built on, replacing five independent ~60-line implementations.
- Safety-net cleanup (`figma-svelte`, `figma-vanilla`): both now close their WebSocket automatically on the page/iframe's `beforeunload` event if the caller forgets to call `destroy()`. This is a backstop, not a replacement for calling `destroy()` on component teardown.
- Runtime validation on `actionName` (`core`): `trackAction`/`trackActionWithMetric` now reject `undefined`/non-string/empty `actionName` (logged, not thrown) instead of silently sending a junk event - matters for untyped JS callers that bypass TypeScript's compile-time check.
- Failed requests now log the API's own message (for example `HTTP 429: Event quota for this billing period is used up`) instead of the bare status.
- `FigmaEditorType` gained `'buzz'`; `FigmaMode` gained `'textreview'`, `'linkpreview'`, `'auth'`, `'query'`.
- `LICENSE` file in every package.
- `session_id` query parameter on the session WebSocket (`core`): identical across the reconnects of one UI session.
- `requestConfigFromPlugin()` and `UI_READY_MESSAGE` exports (`core`), for writing a custom adapter.
- `TodeService`, `TodeClient` and the Svelte store pass `TrackOptions` (`signal`, `eventSource`) through `trackAction`/`trackActionWithMetric`.
- `useTode()` returns `trackAction` and `trackActionWithMetric` (`figma-vue`, `figma-react`), as the Vue docs always showed. In React the functions keep their identity across renders.
- `signal` option on `init()`/`trackAction()`/`trackActionWithMetric()` (`core`): pass an `AbortSignal` to cancel an in-flight request early, independent of the built-in timeout.
- `tode.version` / `VERSION` export (`core`): reports the installed SDK version, for bug reports.
- `sideEffects: false` on `core`, `figma-react`, `figma-vue`, `figma-angular`, `figma-vanilla` `package.json` - lets bundlers tree-shake unused exports. Deliberately omitted on `figma-svelte`, whose default `todeStore` export has a real import-time side effect.
- `engines.node >=18.0.0` on all 6 package.json files, matching the rest of the monorepo.
- `README.md` for every package (previously only the workspace root had one).

### Changed

- A session socket error is logged only with `debug: true`; the reconnect that follows handles it. Failed HTTP requests are still always logged.

- All 6 packages' `repository.url` now point at `kolebayev/tode-sdk` instead of two different stale standalone-repo URLs.

### Documentation

- Documented `apiUrl`/`wsUrl`/`debug`/`signal` `init()` options, the reconnect/backoff behavior, the swallowed-error/429-throttle limitation, and the untested `svelte`/`@angular/core` peer-dependency floor (declared `>=3.0.0` / `>=14.0.0`, only actually built/tested against `^5.19.0` / `^19.1.4`).
