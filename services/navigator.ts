import { Logger } from "../../lib/services/logger";
import { checkStringForExistence, checkStringForNonExistence } from "library/lib/data/data";
import { eventNamesLib } from "library/lib-fe/data/enum";
import { clearChildren, emitNavigationEvent } from "library/lib-fe/helper/dom";
import { DialogOptions, DialogRequest, DialogResult, RenderedLevel, Route, RouteInfo, RouteMatch, SubContainerHost } from "library/lib-fe/types/navigation";

const NOT_FOUND_ROUTE = "404";
const STRUCTURED_DATA_ID = "navigator-structured-data";
const SCROLL_STATE_KEY = "navigatorScroll";
const SCROLL_SAVE_DELAY_MS = 100;
const SCROLL_RESTORE_MAX_FRAMES = 90;
const FALLBACK_NOT_FOUND: Route = {
  content: "page-404",
  title: "404 - Page not found",
  description: "The page you requested was not found!",
  pathType: "WebPage"
};

export class Navigator {
  static #instance: Navigator
  _logger: Logger;

  private appRoot: HTMLElement | null;
  private domain: string;
  private routes: Record<string, Route>;
  /** The routes with parameters, split into their segments. */
  private patterns: { key: string, segments: string[] }[] = [];
  private aliases: Record<string, string>;
  private renderedLevels: RenderedLevel[] = [];
  private currentPath: string | null = null;

  private scrollSaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while a scroll position is being restored; scrolling is not stored then. */
  private restoringScroll = false;
  /** Identifies the latest restoration, so an older one stops when a newer one starts. */
  private scrollRestoreToken = 0;

  private dialog: HTMLDialogElement;
  /** The dialog that is showing now. */
  private activeDialog: DialogRequest | null = null;
  private dialogQueue: DialogRequest[] = [];

  private constructor(domain: string, containerId: string, routes: Record<string, Route>, aliases: Record<string, string>) {
    this._logger = Logger.getInstance();

    this.appRoot = document.querySelector(containerId);
    this.domain = domain;
    this.aliases = aliases;
    this.routes = { ...routes }; // copied, so that `addRoute()` does not change the object of the app
    this.indexRoutes();
    this.dialog = document.createElement('dialog');

    this.init();
  }

  public static getInstance(domain: string, containerId: string, routes: Record<string, Route>, aliases: Record<string, string>): Navigator {
    return this.#instance ??= new Navigator(domain, containerId, routes, aliases);
  }

  private init() {
    this._logger.debug("---> Navigator.init()");
    this.initScrollRestoration();

    // Handle initial load
    this.navigateTo(window.location.pathname, false);
    this.restoreScroll(window.history.state?.[SCROLL_STATE_KEY]); // a reload keeps the state of the entry

    // Handle back/forward navigation
    window.addEventListener('popstate', () => {
      const state = window.history.state ?? {};
      clearTimeout(this.scrollSaveTimer); // a pending save belongs to the entry that was left
      this.navigateTo(window.location.pathname, false, state);
      this.restoreScroll(state[SCROLL_STATE_KEY]);
    });

    // Listen for custom navigate events
    window.addEventListener(eventNamesLib.NAVIGATE.description!, (e: Event) => {
      this._logger.debug(`... received navigation event:`, e);
      const ce = e as CustomEvent;
      this.navigateTo(ce.detail.target, true, ce.detail.stateData ? ce.detail.stateData : {});
    });

    const body = document.querySelector("body")!;
    body.appendChild(this.dialog);

    // The event interface of the dialogs, with callbacks; `Navigator.dialog()` is the promise-based equivalent.
    window.addEventListener(eventNamesLib.DIALOG_OPEN.description!, (e) => {
      e.stopImmediatePropagation();
      const { element, data, confirmCb, cancelCb, options } = (e as CustomEvent).detail;

      this.requestDialog(element, data ?? {}, options ?? {}).then(async (result) => {
        try {
          if (result.confirmed) await confirmCb?.(result.data);
          else await cancelCb?.();
        } catch (error) {
          this._logger.error("A dialog callback failed:", error);
        }
      });
    });

    // Confirming closes the dialog as confirmed; cancelling (through the event, or natively with Esc) closes it as cancelled.
    const onDialogEvent = (event: Event) => {
      event.stopImmediatePropagation();
      if (event.type === eventNamesLib.DIALOG_CONFIRM.description) {
        this.closeDialog({ confirmed: true, data: (event as CustomEvent).detail.data });
      } else {
        this.closeDialog({ confirmed: false });
      }
    };
    for (const type of [eventNamesLib.DIALOG_CONFIRM.description!, eventNamesLib.DIALOG_CANCEL.description!, 'cancel']) {
      this.dialog.addEventListener(type, onDialogEvent);
    }

    // A dialog that was closed in another way (e.g. a `<form method="dialog">` in the component) counts as cancelled, otherwise the dialogs that are waiting would never be shown.
    // The event arrives after the dialog closed, when the next one may already be showing; that one must be left alone.
    this.dialog.addEventListener('close', () => {
      if (this.activeDialog && !this.dialog.open) this.closeDialog({ confirmed: false });
    });
  }

  /**
   * The scroll position is kept in the state of each history entry, so back/forward (and a reload) return to where the user was.
   * The browser's own restoration is switched off, as it runs before the page is rendered and would be wrong for an SPA.
   */
  private initScrollRestoration() {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

    window.addEventListener('scroll', () => {
      if (this.restoringScroll) return; // our own scrolling, or a position that is not final yet
      clearTimeout(this.scrollSaveTimer);
      this.scrollSaveTimer = setTimeout(() => this.saveScroll(), SCROLL_SAVE_DELAY_MS);
    }, { passive: true });

    // Makes sure the last position is stored when the page is left or reloaded.
    window.addEventListener('pagehide', () => this.saveScroll());
  }

  /** Stores the current scroll position in the current history entry. */
  private saveScroll() {
    clearTimeout(this.scrollSaveTimer);
    try {
      const state = window.history.state;
      const base = state && typeof state === 'object' ? state : {};
      window.history.replaceState({ ...base, [SCROLL_STATE_KEY]: { x: window.scrollX, y: window.scrollY } }, '');
    } catch (error) {
      this._logger.warn("The scroll position could not be stored:", error);
    }
  }

  /**
   * Scrolls to the given position. The page content may still be loading (components fetch their data), so the position is
   * tried again for a short while until the page is tall enough, or until the user scrolls by themselves.
   */
  private restoreScroll(position: { x: number, y: number } | undefined) {
    clearTimeout(this.scrollSaveTimer);
    const token = ++this.scrollRestoreToken;
    const { x, y } = position ?? { x: 0, y: 0 };

    this.restoringScroll = true;
    const stop = () => {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
      if (token === this.scrollRestoreToken) this.restoringScroll = false;
    };
    const cancel = () => {
      this.scrollRestoreToken++; // ends the attempts
      stop();
    };
    window.addEventListener('wheel', cancel, { passive: true, once: true });
    window.addEventListener('touchstart', cancel, { passive: true, once: true });
    window.addEventListener('keydown', cancel, { once: true });

    let attempts = 0;
    const attempt = () => {
      if (token !== this.scrollRestoreToken) return stop();

      window.scrollTo(x, y);
      const reached = Math.abs(window.scrollY - y) < 1 && Math.abs(window.scrollX - x) < 1;
      if (reached || ++attempts >= SCROLL_RESTORE_MAX_FRAMES) {
        // Let the scroll events of our own scrolling pass before the position is tracked again.
        requestAnimationFrame(() => {
          if (token === this.scrollRestoreToken) this.saveScroll();
          stop();
        });
        return;
      }
      requestAnimationFrame(attempt);
    };
    attempt();
  }

  /** Requests a dialog. It is shown when it is its turn, and the promise resolves with how it was closed. It never rejects. */
  private requestDialog(element: string, data: object, options: DialogOptions): Promise<DialogResult> {
    return new Promise((resolve) => {
      const key = JSON.stringify([element, data]);

      // An identical dialog is already showing or waiting, so the request joins it instead of showing the same dialog twice.
      const existing = [this.activeDialog, ...this.dialogQueue].find(request => request?.key === key);
      if (existing) {
        existing.resolvers.push(resolve);
        return;
      }

      this.dialogQueue.push({ element, data, key, persistent: options.persistent ?? false, resolvers: [resolve] });
      this.showNextDialog();
    });
  }

  private showNextDialog() {
    if (this.activeDialog) return;

    const request = this.dialogQueue.shift();
    if (!request) return;
    this.activeDialog = request;

    try {
      const el = document.createElement(request.element);
      for (const [key, value] of Object.entries(request.data)) {
        el.setAttribute(key, JSON.stringify(value));
      }
      clearChildren(this.dialog);
      this.dialog.appendChild(el);
      this.dialog.showModal();
    } catch (error) {
      // A dialog that cannot be shown (e.g. an invalid element name) must not block the ones behind it.
      this._logger.error(`Dialog '${request.element}' could not be shown:`, error);
      this.closeDialog({ confirmed: false });
    }
  }

  private closeDialog(result: DialogResult) {
    const request = this.activeDialog;
    if (!request) return;
    this.activeDialog = null;

    if (this.dialog.open) this.dialog.close();
    clearChildren(this.dialog);

    for (const resolve of request.resolvers) resolve(result);
    this.showNextDialog();
  }

  /** Cancels the dialogs that are still waiting, except the ones that asked to stay. */
  private cancelQueuedDialogs() {
    const stale = this.dialogQueue.filter(request => !request.persistent);
    this.dialogQueue = this.dialogQueue.filter(request => request.persistent);

    for (const request of stale) {
      for (const resolve of request.resolvers) resolve({ confirmed: false });
    }
  }

  private static requireInstance(method: string): Navigator | null {
    if (!this.#instance) {
      Logger.getInstance().warn(`Navigator.${method}() was called before the Navigator was created.`);
      return null;
    }
    return this.#instance;
  }

  public static navigate(path: string, pushState = true, stateData: object = {}) {
    this.requireInstance("navigate")?.navigateTo(path, pushState, stateData);
  }

  /**
   * Shows a dialog with the given web-component and resolves with how it was closed.
   * It never rejects.
   * Dialogs are shown one at a time, in the order they were requested; a request that is identical to one that is already showing or waiting shares its dialog and result.
   * Waiting requests are cancelled when the user navigates to another page, unless they are `persistent`.
   *
   *     const result = await Navigator.dialog('confirm-delete', { name: 'report.pdf' });
   *     if (result.confirmed) { ... result.data ... }
   *
   * The component inside the dialog closes it with `emitDialogConfirmEvent()` or `emitDialogCancelEvent()`.
   */
  public static dialog(element: string, data: object = {}, options: DialogOptions = {}): Promise<DialogResult> {
    const navigator = this.requireInstance("dialog");
    return navigator ? navigator.requestDialog(element, data, options) : Promise.resolve({ confirmed: false });
  }

  /**
   * Adds (or replaces) a route after the Navigator was created, e.g. from a module that is loaded later.
   * See `Route` for the format of the key. If the page that is currently shown is the 404 page, the current path is resolved again, as it may now exist. Routes that are known up front are better given to `getInstance()`.
   */
  public static addRoute(key: string, route: Route) {
    const navigator = this.requireInstance("addRoute");
    if (!navigator) return;

    navigator.routes[key] = route;
    navigator.indexRoutes();
    if (navigator.renderedLevels.some(level => level.part === NOT_FOUND_ROUTE)) {
      navigator.navigateTo(window.location.pathname, false, window.history.state ?? {});
    }
  }

  /**
   * For a page component that finds out, after loading its data, that what it was asked to show does not exist (e.g. an unknown product id).
   * Replaces the whole page with the 404 page; the address in the browser stays as it is.
   */
  public static notFound() {
    this.requireInstance("notFound")?.showNotFound();
  }

  /**
   * For a page component that knows better metadata than the route can provide (e.g. the real name of a product).
   * The next navigation replaces it with the metadata of the new route.
   */
  public static setMetadata(metadata: { title?: string, description?: string, structuredData?: object | null }) {
    this.requireInstance("setMetadata")?.applyMetadata(metadata);
  }

  private navigateTo(path: string, pushState = true, stateData: object = {}) {
    this._logger.debug(`---> Navigator.navigateTo(${path}, ${pushState}, ${JSON.stringify(stateData)})`);
    if (!this.appRoot) return;

    const currentLevels = this.renderedLevels;

    let newPath = this.normalisePath(path);
    newPath = this.aliases[newPath] ?? newPath;

    // Going to a new page: the position on the page that is left is stored before anything is rendered, and the new page starts at the top.
    const isNewEntry = pushState && newPath !== window.location.pathname;
    if (isNewEntry) this.saveScroll();

    // The dialogs that are waiting most likely belong to the page that is left. Resolving the same path again (see `addRoute()`) is not leaving it.
    if (newPath !== this.currentPath) this.cancelQueuedDialogs();
    this.currentPath = newPath;
    const newPathParts = newPath.split("/").filter(Boolean);
    const numberOfPathParts = newPathParts.length;
    this._logger.debug(`... new path = ${newPath}`, newPathParts, numberOfPathParts);

    let parentContainer: HTMLElement | null = this.appRoot;
    this._logger.debug("... parentContainer:", parentContainer);

    let lastRoute: RouteInfo | null = null;
    let renderedLevels: RenderedLevel[] = [];

    for (let i = 0; i < numberOfPathParts; i++) {
      if (!parentContainer) {
        // The path is deeper than the rendered components can host (e.g. '/page-one/unknown'), so the path does not exist.
        lastRoute = this.notFoundRoute();
        renderedLevels = [this.createLevel(this.appRoot, NOT_FOUND_ROUTE, lastRoute)];
        break;
      }

      const { key, route } = this.getRoute(newPathParts, i);

      lastRoute = route;
      renderedLevels.push(this.renderLevel(parentContainer, currentLevels[i], key, route));

      if (i < numberOfPathParts - 1) {
        // The sub-container is only needed when another part follows.
        parentContainer = this.getSubContainer(parentContainer.firstChild);
      } else if (currentLevels.length > numberOfPathParts) {
        // The previous path was longer (e.g. '/parent/child' -> '/parent'), so the sub-pages left over from it are removed.
        this.getSubContainer(parentContainer.firstChild)?.replaceChildren();
      }
    }

    if (lastRoute) this.updateMetadata(lastRoute);
    this.renderedLevels = renderedLevels;

    if (pushState) {
      // Re-navigating to the current path must not add another history entry.
      if (newPath === window.location.pathname) window.history.replaceState(stateData, '', newPath);
      else window.history.pushState(stateData, '', newPath);
      if (isNewEntry) this.restoreScroll(undefined);
    }
  }

  private showNotFound() {
    if (!this.appRoot) return;

    const route = this.notFoundRoute();
    this.renderedLevels = [this.createLevel(this.appRoot, NOT_FOUND_ROUTE, route)];
    this.updateMetadata(route);
  }

  private applyMetadata(metadata: { title?: string, description?: string, structuredData?: object | null }) {
    if (checkStringForExistence(metadata.title)) document.title = metadata.title!;
    this.updateDescription(metadata.description);
    if (metadata.structuredData !== undefined) this.updateStructuredData(metadata.structuredData);
  }

  /**
   * Navigate one step back in the browser history.
   * This triggers the `popstate` event, which is handled in `init()`.
   */
  public static back() {
    window.history.back();
  }

  /** Asks a rendered page component (see `SubContainerHost`) for the container of its sub-page, if it has one. */
  private getSubContainer(element: ChildNode | null): HTMLElement | null {
    const host = element as (ChildNode & Partial<SubContainerHost>) | null;
    return typeof host?.declareSubContainer === 'function' ? host.declareSubContainer() : null;
  }

  private createCanonicalUrl(path: string): string {
    this._logger.debug(`---> Navigator.createCanonicalUrl(${path})`);
    return `${this.domain}/${path}`;
  }

  /**
   * Assign an in-app navigation link to the component, on the selected event.
   * @param {HTMLElement} element: The element on which the navigation event is assigned.
   * @param {string} page: The navigation target.
   * @param {Event} event: The event triggering the navigation.
   */
  public static followLink(element: HTMLElement, page: string, event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    emitNavigationEvent(element, page);
  }

  /** Splits the routes with parameters (e.g. `product/:id`) into their segments, to match them against paths. */
  private indexRoutes() {
    this.patterns = Object.keys(this.routes)
      .filter(key => key.includes(":"))
      .map(key => ({ key, segments: key.split("/").filter(Boolean) }));
  }

  /**
   * Finds the route for the part of the path at the given depth: the route for `['product', '42']` at depth 1 is the one for `product/42`.
   * A static path is preferred over a path with parameters (the one with the fewest parameters wins), and that over a plain segment name.
   */
  private matchRoute(pathParts: string[], depth: number): RouteMatch | null {
    const prefix = pathParts.slice(0, depth + 1);
    const fullPath = prefix.join("/");

    if (Object.hasOwn(this.routes, fullPath)) {
      return { key: fullPath, route: this.routes[fullPath], params: {} };
    }

    let best: RouteMatch | null = null;
    for (const pattern of this.patterns) {
      if (pattern.segments.length !== prefix.length) continue;

      const params = this.matchPattern(pattern.segments, prefix);
      if (!params) continue;
      if (!best || Object.keys(params).length < Object.keys(best.params).length) {
        best = { key: pattern.key, route: this.routes[pattern.key], params };
      }
    }
    if (best) return best;

    // A plain segment name, for static pages that are valid at any depth.
    const segment = prefix[depth];
    if (!segment.includes(":") && Object.hasOwn(this.routes, segment)) {
      return { key: segment, route: this.routes[segment], params: {} };
    }

    return null;
  }

  /** Matches the segments of a path against the ones of a route; returns the values of its parameters, or `null` if they do not match. */
  private matchPattern(patternSegments: string[], pathSegments: string[]): Record<string, string> | null {
    const params: Record<string, string> = {};
    for (let i = 0; i < patternSegments.length; i++) {
      const patternSegment = patternSegments[i];
      if (patternSegment.startsWith(":")) {
        try {
          params[patternSegment.slice(1)] = decodeURIComponent(pathSegments[i]);
        } catch {
          return null; // not a valid encoding, so not a valid value
        }
      } else if (patternSegment !== pathSegments[i]) {
        return null;
      }
    }
    return params;
  }

  /** Applies the route's `resolve` to its parameters. Returns `null` if the route is not valid for them. */
  private resolveRoute(match: RouteMatch): Route | null {
    let route: Route = match.route;

    if (route.resolve) {
      try {
        const resolved = route.resolve(match.params);
        if (resolved === null) return null;
        route = { ...route, ...resolved };
      } catch (e) {
        this._logger.error(`Resolving the route '${match.key}' failed:`, e);
        return null;
      }
    }

    // The parameters are given to the page through its nav-data, and cannot be overridden by the route.
    if (Object.keys(match.params).length > 0) {
      route = { ...route, navData: { ...route.navData, params: match.params } };
    }
    return route;
  }

  /** The route for the part of the path at the given depth. Unknown paths and invalid parameters give the 404 page. */
  private getRoute(pathParts: string[], depth: number): { key: string, route: RouteInfo } {
    const match = this.matchRoute(pathParts, depth);
    const route = match ? this.resolveRoute(match) : null;

    if (!match || !route || match.key === NOT_FOUND_ROUTE) {
      return { key: NOT_FOUND_ROUTE, route: this.notFoundRoute() };
    }
    return { key: match.key, route: this.createRouteInfo(route, this.createCanonicalUrl(pathParts.join("/"))) };
  }

  /** The app's own 404 route, or a built-in fallback so that a missing 404 route can never cause a loop. */
  private notFoundRoute(): RouteInfo {
    return this.createRouteInfo(this.routes[NOT_FOUND_ROUTE] ?? FALLBACK_NOT_FOUND, null);
  }

  /** A missing page (no canonical URL) has no canonical address, structured data, or place in search results. */
  private createRouteInfo(r: Route, canonicalUrl: string | null): RouteInfo {
    const notFound = canonicalUrl === null;

    return {
      content: r.content,
      title: r.title,
      description: r.description,
      canonicalUrl,
      structuredData: notFound ? null : {
        // https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
        // https://developers.google.com/search/docs/appearance/structured-data/search-gallery
        "@context": "https://schema.org",
        "@type": r.pathType,
        name: r.title,
        description: r.description,
        url: canonicalUrl
      },
      noindex: notFound,
      navData: r.navData,
      attributes: r.attributes,
      rerender: r.rerender,
    };
  }

  private normalisePath(path: string): string {
    this._logger.debug(`---> Navigator.normalisePath(${path})`);
    if (path == "/") return path;
    if (path == "") return "/";
    if (path[path.length - 1] == "/") path = path.slice(0, -1);
    return path;
  }

  private updateCanonicalUrl(value: string | null | undefined) {
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (checkStringForNonExistence(value)) {
      link?.remove(); // pages without a canonical address must not keep the previous page's one
      return;
    }

    if (!link) {
      link = document.createElement('link');
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", value!);
  }

  /** All the attributes the Navigator sets on a page element: the route's attributes, and its nav-data as JSON. */
  private buildAttributes(route: RouteInfo): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (route.navData) attributes["nav-data"] = JSON.stringify(route.navData);
    return Object.assign(attributes, route.attributes);
  }

  /**
   * Makes sure the container shows the page for this route, with as little work as possible:
   * - nothing changed: the rendered element is kept as it is;
   * - the same page with different attributes or nav-data: the element is updated in place, unless the route asks for `rerender`;
   * - anything else: a new element replaces the content of the container.
   */
  private renderLevel(container: HTMLElement, current: RenderedLevel | undefined, part: string, route: RouteInfo): RenderedLevel {
    const attributes = this.buildAttributes(route);
    const key = JSON.stringify([route.content, attributes]);

    // The element must still be in this container; it is not when a parent page above it was replaced.
    if (current && current.part === part && current.element.parentNode === container && current.element.localName === route.content.toLowerCase()) {
      if (current.key === key) return current;

      if (!route.rerender) {
        this._logger.debug(`... updating part in place: ${part}`);
        this.patchElement(current, attributes, key);
        return current;
      }
    }

    this._logger.debug(`... rendering part: ${part}`);
    return this.createLevel(container, part, route);
  }

  /**
   * Replaces the content of the container with a new element of the route's web-component.
   * The attributes are set before the element is added to the DOM, so the component has all of them when it connects.
   */
  private createLevel(container: HTMLElement, part: string, route: RouteInfo): RenderedLevel {
    const attributes = this.buildAttributes(route);
    const element: HTMLElement = document.createElement(route.content);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    container.replaceChildren(element);

    return { part, key: JSON.stringify([route.content, attributes]), element, attributes };
  }

  /**
   * Brings the attributes the Navigator set on an element in line with the new ones.
   * Only attributes set by the Navigator are touched, never the ones the component sets on itself.
   * The component reacts through `attributeChangedCallback`.
   */
  private patchElement(level: RenderedLevel, attributes: Record<string, string>, key: string) {
    for (const name of Object.keys(level.attributes)) {
      if (!(name in attributes)) level.element.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (level.attributes[name] !== value) level.element.setAttribute(name, value);
    }
    level.attributes = attributes;
    level.key = key;
  }

  private updateMetadata(route: RouteInfo) {
    this._logger.debug(`---> Navigator.updateMetadata()`, route);
    if (checkStringForExistence(route.title)) document.title = route.title;
    this.updateDescription(route.description);
    this.updateCanonicalUrl(route.canonicalUrl);
    this.updateRobots(route.noindex);
    this.updateStructuredData(route.structuredData);
  }

  private updateDescription(value: string | null | undefined) {
    if (checkStringForNonExistence(value)) return;

    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", value!);
  }

  private updateRobots(noindex: boolean | undefined) {
    // Only the tag created here is managed, so a robots tag written by the app itself is never touched.
    let meta = document.querySelector('meta[name="robots"][data-navigator]') as HTMLMetaElement | null;
    if (!noindex) {
      meta?.remove();
      return;
    }

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute("name", "robots");
      meta.setAttribute("data-navigator", "");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex");
  }

  private updateStructuredData(data: object | null | undefined) {
    // Only the script created here is replaced, so JSON-LD written by the app itself is never removed.
    document.getElementById(STRUCTURED_DATA_ID)?.remove();
    if (data == null) return;

    const script = document.createElement('script');
    script.id = STRUCTURED_DATA_ID;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }
}
