import { Logger } from "../../lib/services/logger";
import { checkStringForExistence, checkStringForNonExistence } from "lib/lib/data/data";
import { eventNamesLib } from "lib/lib-fe/data/enum";
import { clearChildren, emitNavigationEvent } from "lib/lib-fe/helper/dom";
import { Route, RouteInfo } from "lib/lib/types";

export class Navigator {
  static #instance: Navigator
  _logger: Logger;

  private appRoot: HTMLElement | null;
  private domain: string;
  private subPageContainers: Record<string, HTMLElement>;
  private routes: Record<string, Route>;
  private aliases: Record<string, string>;

  private dialog: HTMLDialogElement;
  private dialogConfirmCallback: (data?: unknown) => Promise<void>;
  private dialogCancelCallback: () => Promise<void>;

  private constructor(domain: string, containerId: string, routes: Record<string, Route>, aliases: Record<string, string>) {
    this._logger = Logger.getInstance();

    this.appRoot = document.querySelector(containerId);
    this.domain = domain;
    this.aliases = aliases;
    this.routes = routes;
    this.subPageContainers = {};
    this.dialog = document.createElement('dialog');
    this.dialogConfirmCallback = async () => { };
    this.dialogCancelCallback = async () => { };

    this.init();
  }

  public static getInstance(domain: string, containerId: string, routes: Record<string, Route>, aliases: Record<string, string>): Navigator {
    return this.#instance ??= new Navigator(domain, containerId, routes, aliases);
  }

  init() {
    this._logger.debug("---> Navigator.init()");
    // Handle initial load
    this.navigateTo(window.location.pathname, false);

    // Handle back/forward navigation
    window.addEventListener('popstate', () => {
      this.navigateTo(window.location.pathname, false);
    });

    // Listen for custom navigate events
    window.addEventListener(eventNamesLib.NAVIGATE.description!, (e: Event) => {
      this._logger.debug(`... received navigation event:`, e);
      const ce = e as CustomEvent;
      this.navigateTo(ce.detail.target, true, ce.detail.stateData ? ce.detail.stateData : {});
    });

    const body = document.querySelector("body")!;
    body.appendChild(this.dialog);

    window.addEventListener(eventNamesLib.DIALOG_OPEN.description!, (e) => {
      e.stopImmediatePropagation();
      const ce = e as CustomEvent;
      clearChildren(this.dialog);

      this.dialogConfirmCallback = ce.detail.confirmCb ? ce.detail.confirmCb : async () => { };
      this.dialogCancelCallback = ce.detail.cancelCb ? ce.detail.cancelCb : async () => { };

      let el = document.createElement(ce.detail.element);
      for (const [key, value] of Object.entries(ce.detail.data)) {
        el.setAttribute(key, JSON.stringify(value));
      }
      this.dialog.appendChild(el);

      this.dialog.showModal();
    });
    this.dialog.addEventListener(eventNamesLib.DIALOG_CONFIRM.description!, async (event) => {
      event.stopImmediatePropagation();
      this.dialog.close();
      await this.dialogConfirmCallback((event as CustomEvent).detail.data);

      this.dialogCancelCallback = async () => { };
      this.dialogConfirmCallback = async () => { };
    });
    this.dialog.addEventListener(eventNamesLib.DIALOG_CANCEL.description!, async (event) => {
      event.stopImmediatePropagation();
      this.dialog.close();
      await this.dialogCancelCallback();

      this.dialogCancelCallback = async () => { };
      this.dialogConfirmCallback = async () => { };
    });
    this.dialog.addEventListener('cancel', async (event) => {
      event.stopImmediatePropagation();
      this.dialog.close();
      await this.dialogCancelCallback();

      this.dialogCancelCallback = async () => { };
      this.dialogConfirmCallback = async () => { };
    });
  }

  public static navigate(path: string, pushState = true, stateData: object = {}) {
    this.#instance.navigateTo(path, pushState, stateData);
  };

  private navigateTo(path: string, pushState = true, stateData: object = {}) {
    this._logger.debug(`---> Navigator.navigateTo(${path}, ${pushState}, ${JSON.stringify(stateData)})`);
    if (!this.appRoot) return;

    const currentPath = window.location.pathname;
    const currentPathParts = currentPath.split("/").filter(Boolean);
    // console.log(`... currentPath = ${ currentPath }`, currentPathParts);

    let newPath = this.normalisePath(path);
    if (newPath == "/") {
      newPath = this.aliases["/"];
    }
    const newPathParts = newPath.split("/").filter(Boolean);
    const numberOfPathParts = newPathParts.length;
    this._logger.debug(`... new path = ${newPath}}`, newPathParts, numberOfPathParts);

    if (!this.appRoot) return;
    let parentContainer: HTMLElement = this.appRoot;
    this._logger.debug("... parentContainer:", parentContainer);

    for (let i = 0; i < numberOfPathParts; i++) {
      let part = newPathParts[i];
      let route = this.getRoute(part, newPathParts);

      if (part != currentPathParts[i] || !parentContainer.firstChild) {
        this._logger.debug(`... updating part: ${part}`);
        this.updateContent(parentContainer, route.content, route.navData);
      }
      parentContainer = "declareSubContainer" in (parentContainer.firstChild as object) ? (parentContainer.firstChild as any).declareSubContainer() : null;

      if (i == numberOfPathParts - 1) {
        this.updateMetadata(route);
      }
    }

    if (pushState) {
      window.history.pushState({}, '', newPath);
    }
  }

  public cleanContainers(newPathParts: string[], currentPathParts: string[]) {
    this._logger.debug(`---> Navigator.cleanContainers(${JSON.stringify(newPathParts)}, ${JSON.stringify(currentPathParts)})`);
    for (let newPart of newPathParts) {
      if (!currentPathParts.includes(newPart)) {
        delete this.subPageContainers[newPart];
      }
    }
    this._logger.debug(`... this.$subPageContainers (after cleaning):`, this.subPageContainers);
  }

  private createCanonicalUrl(path: string): string {
    this._logger.debug(`---> Navigator.createCanonicalUrl(${path})`);
    return `${this.domain}/${path}`;
  }

  private createContentElement(content: string): string {
    return `<${content}></${content}>`;
  }

  public static followLink(element: HTMLElement, page: string, event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    emitNavigationEvent(element, page);
  }

  private getRoute(route: string, pathParts: string[]): RouteInfo {
    let r = this.routes[route];
    if (!r) return this.getRoute("404", []);

    return {
      content: this.createContentElement(r.content),
      title: r.title,
      description: r.description,
      canonicalUrl: this.createCanonicalUrl(pathParts.join("/")),
      structuredData: {
        // https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
        // https://developers.google.com/search/docs/appearance/structured-data/search-gallery
        "@context": "https://schema.org",
        "@type": r.pathType,
        name: r.title,
        description: r.description,
        url: this.createCanonicalUrl(r.content)
      },
      navData: r.navData
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
    if (checkStringForNonExistence(value)) return;

    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", value!);
  }

  private updateContent(parentContainer: HTMLElement | null, content: string, navData?: Record<string, unknown>) {
    this._logger.debug(`--> Navigator.updateContent()`, parentContainer, content, navData);
    if (checkStringForNonExistence(content) || !parentContainer) return;

    parentContainer.innerHTML = content;
    if (navData) (parentContainer.firstChild as Element).setAttribute("nav-data", JSON.stringify(navData));
  }

  private updateMetadata(route: RouteInfo) {
    this._logger.debug(`---> Navigator.updateMetadata()`, route);
    if (checkStringForExistence(route.title)) document.title = route.title;
    if (checkStringForExistence(route.description)) document.querySelector('meta[name="description"]')!.setAttribute('content', route.description);
    this.updateCanonicalUrl(route.canonicalUrl);
    this.updateStructuredData(route.structuredData);
  }

  private updateStructuredData(data: object | null | undefined) {
    if (data == null || data == undefined) return;

    const existingScript = document.querySelector('script[type="application/ld+json"]');
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }
}
