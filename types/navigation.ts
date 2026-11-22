export type DialogOptions = {
  /**
   * Dialogs are shown one at a time. When the user navigates to another page, the requests that are still waiting are cancelled, as they most likely belong to the page that was left. Set this to keep the request waiting.
   * A dialog that is already showing is never closed by navigation.
   */
  persistent?: boolean;
}

/** A requested dialog, waiting or showing. Identical requests share one dialog, and all of them get its result. */
export type DialogRequest = {
  element: string;
  data: object;
  /** Identifies the dialog, to recognise identical requests. */
  key: string;
  persistent: boolean;
  resolvers: ((result: DialogResult) => void)[];
}

/** How a dialog was closed: confirmed (with the data of the dialog), or cancelled (by the user, by Esc, or because it became stale). */
export type DialogResult = { confirmed: true; data: unknown } | { confirmed: false };

export type PathType = 'WebPage' | 'Dialog';

/** What the Navigator rendered at one depth of the path. */
export type RenderedLevel = {
  /** The key of the route that was rendered (e.g. `product/:id`), not the literal path segment (e.g. `42`). */
  part: string;
  /** Identifies the page and the attributes it was rendered with; a different key means the page needs updating. */
  key: string;
  element: HTMLElement;
  /** The attributes (including `nav-data`) that the Navigator set on the element. */
  attributes: Record<string, string>;
}

/**
 * A route is registered under a key, which is either:
 * - a path from the root, like `product` or `product/details`; it matches exactly that path;
 * - a path with parameters, like `product/:id` or `shop/:shopId/product/:id`; each `:name` matches any single segment and the matched values are given to `resolve` and are available to the page in its `nav-data` as `params`;
 * - for static pages only, a single segment name, like `contact`, which matches that segment at any depth.
 * A static path is preferred over a parameter path, and a parameter path over a segment name.
 */
export type Route = {
  content: string;
  title: string;
  description: string;
  pathType: PathType;
  navData?: Record<string, unknown>;
  attributes?: Record<string, string>;
  /**
   * By default, when the attributes or nav-data of an already rendered page change, the existing element is updated in place.
   * Set this to replace the element with a new one instead, for components that cannot react to attribute changes.
   * Note that replacing a page also discards its sub-pages.
   */
  rerender?: boolean;
  /**
   * Builds the route's data from the parameters matched in the path (e.g. `{ id: "42" }`). It must be synchronous.
   * The returned values override the route's own; return `null` if the parameters are not valid, which shows the 404 page.
   * Anything that needs to be loaded (like the real name of a product) belongs in the page component, which can then
   * call `Navigator.setMetadata()` or `Navigator.notFound()`.
   */
  resolve?: (params: Record<string, string>) => Partial<Omit<Route, 'resolve'>> | null;
}

export type RouteInfo = {
  content: string;
  title: string;
  description: string;
  canonicalUrl?: string | null;
  structuredData?: object | null;
  noindex?: boolean; // True for pages that must not be indexed by search engines, like the 404 page.
  navData?: Record<string, unknown>;
  attributes?: Record<string, string>;
  rerender?: boolean;
}

/** A route that matched a path, with the values of its parameters. */
export type RouteMatch = {
  key: string;
  route: Route;
  params: Record<string, string>;
}

/**
 * Implemented by a page component that hosts sub-pages (the next part of the path).
 * The Navigator calls it to find where the sub-page is rendered.
 * The container must be available synchronously once the component is created; return `null` if there is none.
 */
export interface SubContainerHost {
  declareSubContainer(): HTMLElement | null;
}
