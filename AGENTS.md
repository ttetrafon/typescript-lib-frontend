# lib-fe — instructions for LLMs

`lib-fe` is a framework-free front-end library: TypeScript, native Web Components (shadow DOM), and Vite. It provides a router/dialog service (`Navigator`), cross-tab reactive state (`State`), translations (`Translator`), shared stylesheets, a few ready-made components, and DOM/HTTP helpers.

It is not a package. It is a git submodule/folder (`library/lib-fe`) inside a host app (e.g. `template-website`), next to a sibling library `library/lib` (logger, uuid, string helpers). There is no `package.json` here; the host app owns the toolchain (Vite, TypeScript, Vitest, jsdom).

## Rules

- **Import through the `library/` alias**: `import { State } from "library/lib-fe/services/state"`. Do not use deep relative paths from the app into the library. (The alias is defined in the host's `vite.config.ts` and `tsconfig.json`.)
- **Never edit the library to suit one app.** App-specific behaviour belongs in the app's `src/`. Change `lib-fe` only when the task is about the library itself, and keep changes generic.
- **Singletons**: `Navigator`, `State`, `Translator`, `Logger`, and `WindowSizeWatcher` are created once with `getInstance(...)`. Create them in the app entry point (`src/main.ts`); elsewhere call `getInstance` with the same arguments (for `State`, the same app name).
- **No frameworks.** UI is custom elements with shadow DOM. Do not add React/Lit/etc.
- Use `Logger.getInstance()` (from `library/lib/services/logger`) instead of bare `console.log`.
- Asynchronous event/DOM helpers in `helper/dom.ts` are `async` but do not need `await` unless you rely on completion.
- Before finishing, run `pnpm typecheck` and `pnpm test` in the host app root.

## Layout

| Path                                          | Purpose                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `services/navigator.ts`                       | Router + modal dialogs + page metadata (SEO)                                                |
| `services/state.ts`, `wrappers/Observable.ts` | Observable state, synced across tabs, optional localStorage persistence                     |
| `services/translator.ts`                      | Text/attribute translations for elements                                                    |
| `services/styles.ts`                          | Named shared stylesheet registry (`registerStyles`, `resolveStyles`)                        |
| `components/`                                 | Web components (each: `script.ts`, `doc.html`, `styles.css`) and two **templates**          |
| `helper/dom.ts`                               | DOM helpers and the custom-event emitters                                                   |
| `util/Requests.ts`                            | `fetch` wrappers (plain and DPoP-signed)                                                    |
| `util/WindowSize.ts`                          | `WindowSizeWatcher`: publishes window size as an observable                                 |
| `util/device.ts`                              | `getDeviceLabel()`                                                                          |
| `security/dpop.ts`                            | DPoP (RFC 9449) proof generation, non-extractable key in IndexedDB                          |
| `data/enum.ts`, `data/constants.ts`           | Event-name symbols, constants                                                               |
| `types/`                                      | Shared types (`Route`, `DialogOptions`, `SubContainerHost`, state types, `MkDocument`, ...) |
| `styles/reset.css`                            | CSS reset; import into every component                                                      |
| `icons/google/*.svg`                          | ~3700 Material icons (use only via the icon registry)                                       |

## Typical app wiring (`src/main.ts`)

```ts
import 'library/lib-fe/components/404/script';          // register custom elements by importing them
import './components/page-1/script';
import { Logger } from 'library/lib/services/logger';
import { Navigator } from 'library/lib-fe/services/navigator';
import { State } from 'library/lib-fe/services/state';
import { WindowSizeWatcher } from 'library/lib-fe/util/WindowSize';

const state = State.getInstance('My App');
Navigator.getInstance('https://example.com', '#app', routes, aliases); // (domain, container selector, routes, aliases)
WindowSizeWatcher.getInstance(state);                                    // optional
```

`index.html` needs a container (`<main id="app">`). Import `library/lib-fe/styles/reset.css` in the app stylesheet.

## Navigator (`services/navigator.ts`)

### Routes

`routes: Record<string, Route>`; `aliases: Record<string, string>` (e.g. `{ '/': '/page-one' }`, applied to the normalised path).

```ts
const routes: Record<string, Route> = {
  'page-one': { content: 'page-1', title: 'Page 1', description: '...', pathType: 'WebPage', navData: { a: 1 }, attributes: { 'app-name': AppName } },
  'product/:id': {
    content: 'product-page', title: 'Product', description: '...', pathType: 'WebPage',
    resolve: ({ id }) => /^\d+$/.test(id) ? { title: `Product ${id}` } : null,   // null => 404. Must be synchronous.
  },
  '404': { content: 'page-404', title: '404', description: '...', pathType: 'WebPage' },
};
```

- `content` is the **tag name** of the custom element to render. The component must be imported (registered) by the app.
- Key forms: a full path (`product/details`), a path with params (`product/:id`), or a plain segment name (valid at any depth). Match priority: exact path > fewest params > segment name.
- Always provide a `404` route (a built-in fallback exists, but the app's one should be used). `Navigator.notFound()` shows it from inside a component without changing the URL.
- The element receives: route `attributes`, plus `nav-data` (JSON of `navData`; matched params arrive as `navData.params`). Attributes are set **before** the element is connected.
- If only attributes/nav-data change for the same page, the element is **updated in place** (the component must react in `attributeChangedCallback`, observing `nav-data`). Set `rerender: true` to replace the element instead (this discards sub-pages).
- **Nested routes**: a path `a/b` renders `a` first, then `b` inside the container returned by `a`'s `declareSubContainer()` (interface `SubContainerHost`; must return synchronously, or `null`). A path deeper than the components can host gives 404.
- Metadata (`title`, `description`, canonical link, robots `noindex` for 404, JSON-LD) is updated automatically from the route. A page that knows better data calls `Navigator.setMetadata({ title, description, structuredData })`.

### Navigating

- In app code: `Navigator.navigate(path, pushState = true, stateData = {})`, `Navigator.back()`.
- From a link: `link.addEventListener('click', e => Navigator.followLink(link, 'page-one', e))` (prevents default, emits the navigation event).
- From inside a component without importing Navigator: `emitNavigationEvent(this, 'page-one', stateData?)` from `helper/dom.ts`. The event bubbles and is composed, so it crosses shadow roots.
- Add routes late with `Navigator.addRoute(key, route)`.
- Static `Navigator.*` calls before `getInstance()` only log a warning and do nothing.

### Dialogs

```ts
const result = await Navigator.dialog('confirm-delete', { name: 'report.pdf' }, { persistent: false });
if (result.confirmed) { /* result.data */ }   // result: { confirmed: true, data } | { confirmed: false }; never rejects
```

- `'confirm-delete'` is a custom-element tag. Each key of the data object is set as an attribute **JSON-stringified** (so read with `JSON.parse`).
- The dialog component closes itself with `emitDialogConfirmEvent(this, data)` or `emitDialogCancelEvent(this)`. Esc counts as cancel.
- One dialog at a time (queue); identical requests (same element and data) share a dialog and result; queued dialogs are cancelled on navigation unless `persistent: true`.
- Callback-style alternative: `emitDialogEvent(this, 'tag', data, confirmCb, cancelCb, options)`.

## State (`services/state.ts`)

Named observables, deep-copied on read/write (`structuredClone`), so values must be structured-cloneable (no functions/DOM nodes). Names must be non-empty and **without dots** (dots address sub-properties: `"user.address.city"`). State is synced between tabs through `BroadcastChannel`.

```ts
const s = State.getInstance(AppName);
s.createObservable('user', { name: 'A' }, { localStorage: true, broadcastCreation: true }); // fails (warning) if it already exists
s.updateObservable('user.name', 'B');            // whole or partial; 3rd arg false = do not broadcast
const name = await s.getValueFromObservable<string>('user.name', 0); // null if missing; timeoutMs > 0 waits for creation
const cancel = s.whenAvailable<User>('user', (u) => { ... });        // cancellable wait; call cancel() in disconnectedCallback
s.subscribeToObservable('user', 'my-component', { 'user.name': this.onName.bind(this) }, defaultValue);
s.unsubscribeFromObservable('user', 'my-component');                  // do this in disconnectedCallback
s.removeObservable('user');
```

- Listener signature: `(subscriber, watchedPath, updatedValue) => void`. Always `.bind(this)`. A listener fires when the updated path equals, contains, or is inside the watched path.
- `subscribeToObservable` on a missing observable creates a **placeholder** with the default value; `createObservable` later replaces it (and the subscribers are notified). Placeholders are not shared with other tabs and do not satisfy `whenAvailable`.
- With `localStorage: true`, a value already stored wins over the given initial value. Persisted observables are always broadcast.
- Mutating an object you passed in or got back does nothing: call `updateObservable` with the new value.
- On startup `State` asks other tabs for their state (1 s timeout); `getValueFromObservable` waits for that.
- `State.getInstance` ignores a different app name after the first call (warning).
- Well-known observable: `OBSERVABLE_WINDOW_SIZE` (`data/constants.ts`), kept up to date by `WindowSizeWatcher` (value type `WindowSize` from `types/html.ts`).

## Translator (`services/translator.ts`)

```ts
const t = Translator.getInstance();                     // language read from <html lang="...">
t.registerElementsForTranslations('i18n-prefix', { 'my-title': el }, { 'my-title': { text: { en: 'Hello', fr: 'Bonjour' }, title: {...}, ariaLabel: {...}, alt: {...}, placeholder: {...} } });
t.unregisterElementsForTranslations('i18n-prefix', elements);   // on disconnect
await t.applyAllTranslations('fr');                              // switch language
```

- Keys are `${i18n}-${id}`; the component's `i18n` attribute is the prefix. Element ids in the shadow DOM match the keys of `translations`.
- `text` only replaces content of elements that already have text. `page-title` / `page-description` keys (through `addTranslation`) translate the document meta via `applyMetaTranslations()`.
- Note: `addTranslation` on an existing key only updates `text` and `ariaLabel`.

## Styles (`services/styles.ts`, `styles/reset.css`)

- Components build one shared `CSSStyleSheet` (reset + component CSS, imported with `?inline`) and adopt it: `shadow.adoptedStyleSheets = [sheet]`.
- Apps can restyle components without changing the library: `registerStyles('app-404', css)` once, then `<page-404 styles="app-404">` (or `attributes: { styles: 'app-404' }` in a route). Names are space/comma separated; the component's own sheet comes first so app sheets override it. A name may be used before it is registered.
- Components that support this observe the `styles` attribute (`404`, `svg-wrapper`, `mk-line`, `md-editor`, the library template).

## Components

Import a component's `script.ts` for its side effect (it calls `customElements.define`).

| Tag           | Import                          | Notes                                                                                                                                                       |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page-404`    | `components/404/script`         | Not-found page; link back to `/`                                                                                                                            |
| `svg-wrapper` | `components/svg-wrapper/script` | Attributes `name`, `set` (default `google`), `styles`. Scales to its container; colour follows `color` (`fill: currentColor`)                               |
| `mk-editor`   | `components/md-editor/script`   | Attributes `app-name`, `document-id`, `i18n`, `styles`. Reads an `MkDocument` observable named by `document-id` (see `types/mkEditor.ts`). Work in progress |
| `mk-line`     | `components/mk-line/script`     | One line of the editor (textarea). Work in progress                                                                                                         |

### Icons

The icon folder is huge: **never glob-import it** (it would bundle all 3700). Register only what the app uses, with literal imports:

```ts
import { registerIcons } from 'library/lib-fe/components/svg-wrapper/script';
registerIcons('google', {
  home: () => import('library/lib-fe/icons/google/home.svg?raw'),
});
// <svg-wrapper set="google" name="home"></svg-wrapper>
```

### Writing a new component

Copy a template and rename; do not write one from scratch.

- `components/--- template (app)/` for an app page/component (it also implements `SubContainerHost`; remove `declareSubContainer` if unused — the template version throws).
- `components/--- template (library)/` for a reusable library component (has `app-name` and `styles` support).

Each component = `script.ts` + `doc.html` (template markup, imported with `?raw`) + `styles.css` (imported with `?inline`). Conventions:

- Tag name must contain a hyphen, is defined once at the bottom of `script.ts` (`window.customElements.define`).
- Parse the template once at module level; clone it into the shadow root in the constructor; **no DOM manipulation in the constructor**.
- Attributes are the input API: list them in `observedAttributes`, expose getters/setters, JSON-parse complex ones (`data`, `nav-data`).
- Setup that needs DOM or services goes in `connectedCallback` (guard one-time work with `this.initialised`); it can run multiple times.
- In `disconnectedCallback` release everything global: `State` subscriptions / `whenAvailable` cancellers, `Translator` registrations, `window`/`document` listeners.
- Events that must leave the shadow DOM use the `helper/dom.ts` emitters (bubbling + composed), not direct calls to other components.
- Look up inner elements with `this.#shadow.getElementById/querySelector`, not `document`.

## HTTP (`util/Requests.ts`, `security/dpop.ts`)

- `requestGet<T>(url, withAuth)`, `requestPost<T>(url, jsonString, withAuth)`; `request<T>(url, method, data?, headers?, credentials?)` is the generic form. Bodies are **already-stringified JSON**; the response is parsed as JSON; a non-2xx status throws `Error`.
- `withAuth = true` signs the request with a DPoP proof (non-extractable ES256 key in IndexedDB), handles the server nonce challenge (`use_dpop_nonce`) with one retry, and sends credentials (`include`). The server must expose the `DPoP-Nonce` header via CORS.
- `resetDpopKey()` on logout so the next login binds to a fresh key.
- `getDeviceLabel()` returns a human-readable, non-unique device label (not a security control).

## Events (`data/enum.ts`)

`eventNamesLib` holds `Symbol`s; the event name on the DOM is the symbol's `.description`. Use the emitters in `helper/dom.ts` instead of dispatching manually: `emitCustomEvent`, `emitNavigationEvent`, `emitDialogEvent`, `emitDialogConfirmEvent`, `emitDialogCancelEvent`, `emitSubPageContainerEvent`, `toggleSpinningCircle`. `generalNamesLib` holds other shared symbols (connection state, content-filter types, state broadcast types).

## Tests

Vitest + jsdom, files next to the source (`*.test.ts`: `navigator`, `state`, `Observable`). Run from the host app: `pnpm test` (typecheck first, then `vitest --run`). Add or update tests when changing `Navigator`, `State`, or `Observable`.

## Pitfalls

- Importing a component's script is what registers it; a route whose `content` tag is not imported renders an inert unknown element.
- Dialog data and Navigator attributes are serialised as strings; read them with `JSON.parse`.
- `Navigator.getInstance` / `State.getInstance` arguments only matter for the first call.
- Observable values are copies; do not rely on object identity or in-place mutation.
- Do not add icons by glob, and do not import from `library/lib-fe/icons/google/*` outside the registry pattern.
- Some leftovers still exist in the library (e.g. `State.getInstance("...")` in `mk-line` and the app template, with a `FIXME`): pass the real app name when copying.
