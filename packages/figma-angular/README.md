# @tode-sdk/figma-angular

Angular service for using Tode Analytics in a Figma plugin's UI (iframe).

```bash
npm install @tode-sdk/core @tode-sdk/figma-angular
```

## Usage

```typescript
import { Component, OnInit } from '@angular/core';
import { TodeService } from '@tode-sdk/figma-angular';

@Component({
  selector: 'app-root',
  template: `
    <button (click)="track()">Click me</button>
    <p>WebSocket: {{ todeService.wsState$ | async }}</p>
  `,
})
export class AppComponent implements OnInit {
  constructor(public todeService: TodeService) {}

  ngOnInit() {
    // Call synchronously, as early as possible - see "Configuration timing" below.
    this.todeService.configure({ debug: true });
  }

  track() {
    if (this.todeService.isReady) {
      this.todeService.trackAction('button_clicked');
    }
  }
}
```

`TodeService` is a root-provided singleton (`providedIn: 'root'`) - inject it, don't instantiate it yourself. Requires `tode.init({ apiKey })` to have already run in the plugin controller (`code.ts`) - see the [docs](https://docs.usetode.dev).

## `TodeService`

| Member | Description |
|---|---|
| `configure(config)` | Sets `{ debug?, pingInterval? }`. Call synchronously right after injection (e.g. in `ngOnInit`) - see below. |
| `isReady` / `isReady$` | Current ready state, synchronously and as an `Observable<boolean>` |
| `wsState` / `wsState$` | Current session WebSocket state, synchronously and as an `Observable<WebSocketState>` |
| `tode` | Direct access to the underlying `@tode-sdk/core` singleton |
| `trackAction(name, options?)` / `trackActionWithMetric(name, value, options?)` | Convenience delegates to `tode.trackAction` / `tode.trackActionWithMetric` |

### Configuration timing

The service starts listening for the plugin controller's config message as soon as it's constructed (Angular's DI instantiates it the first time any component injects it). If `tode` is already ready at that point, the service defers its first connection attempt by one microtask so a `configure()` call made synchronously afterward - the typical pattern, from a component's `ngOnInit` - is guaranteed to apply before that first connection begins.

Cleanup runs automatically via `ngOnDestroy` when the service itself is destroyed (uncommon for a root-provided singleton, but automatic if it happens).
