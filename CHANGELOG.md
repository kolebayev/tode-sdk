# Changelog

All notable changes to the `@tode-sdk/*` packages are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). All six packages share one version; releases are cut by tagging `sdk-v<version>`, which runs `.github/workflows/sdk-publish.yml`.

## [1.0.0] - 2026-10-07

First npm release. Default endpoints moved to `https://processing.usetode.dev` and `wss://processing.usetode.dev`, matching the `manifest.json` allow-list in the docs.

### Fixed

- **Silent event loss** (`core`): `trackAction`/`trackActionWithMetric` now send `'unknown'`/`''` instead of raw `null` for `userCountry`/`figma_userId`/`figma_pluginId` when unavailable (no Figma identity permission, failed GeoIP lookup). Previously the backend's required-field validation silently rejected these events with a 400 that the SDK never surfaced.
- **No reconnect on dropped session WebSocket** (all adapters): every adapter now automatically reconnects with exponential backoff (1s → 30s, 5 attempts by default) instead of leaving session tracking permanently dead for the rest of the UI session after any network blip.
- **Angular `configure()` race** (`figma-angular`): `TodeService`'s first connection attempt is now deferred one microtask, so a `configure({ debug, pingInterval })` call made synchronously after injection (the documented `ngOnInit` pattern) reliably applies before that first attempt begins.
- **Svelte SSR crash** (`figma-svelte`): the module-level `todeStore` singleton no longer throws when imported in a non-browser environment (e.g. SSR) where `window` doesn't exist.
- **Hung `init()` on a stalled network request** (`core`): all outgoing requests now have a 10s default timeout via `AbortController`, instead of blocking indefinitely.

### Added

- `createSessionSocket()` (`core`) - the shared WebSocket session-tracking helper (ping keepalive + reconnect) every adapter is now built on, replacing five independent ~60-line implementations.
- Safety-net cleanup (`figma-svelte`, `figma-vanilla`): both now close their WebSocket automatically on the page/iframe's `beforeunload` event if the caller forgets to call `destroy()`. This is a backstop, not a replacement for calling `destroy()` on component teardown.
- Runtime validation on `actionName` (`core`): `trackAction`/`trackActionWithMetric` now reject `undefined`/non-string/empty `actionName` (logged, not thrown) instead of silently sending a junk event - matters for untyped JS callers that bypass TypeScript's compile-time check.
- `signal` option on `init()`/`trackAction()`/`trackActionWithMetric()` (`core`): pass an `AbortSignal` to cancel an in-flight request early, independent of the built-in timeout.
- `tode.version` / `VERSION` export (`core`): reports the installed SDK version, for bug reports.
- `sideEffects: false` on `core`, `figma-react`, `figma-vue`, `figma-angular`, `figma-vanilla` `package.json` - lets bundlers tree-shake unused exports. Deliberately omitted on `figma-svelte`, whose default `todeStore` export has a real import-time side effect.
- `engines.node >=18.0.0` on all 6 package.json files, matching the rest of the monorepo.
- `README.md` for every package (previously only the workspace root had one).

### Changed

- All 6 packages' `repository.url` now point at this monorepo (`kolebayev/tode-analytics`) instead of two different stale standalone-repo URLs left over from before `tode-sdk` was merged in.

### Documentation

- Documented `apiUrl`/`wsUrl`/`debug`/`signal` `init()` options, the reconnect/backoff behavior, the swallowed-error/429-throttle limitation, and the untested `svelte`/`@angular/core` peer-dependency floor (declared `>=3.0.0` / `>=14.0.0`, only actually built/tested against `^5.19.0` / `^19.1.4`).
