import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator as NavigatorClass } from './navigator';
import type { DialogResult, Route } from 'library/lib-fe/types/navigation';

///////////////////////
///   ENVIRONMENT   ///
///////////////////////

// jsdom does not implement the methods of the dialog element; these follow the behaviour of the browsers.
const dialogPrototype = HTMLDialogElement.prototype as any;
if (typeof dialogPrototype.showModal !== 'function') {
  dialogPrototype.showModal = function (this: HTMLDialogElement) {
    if (this.hasAttribute('open')) throw new DOMException('The dialog is already open.', 'InvalidStateError');
    this.setAttribute('open', '');
  };
}
if (typeof dialogPrototype.close !== 'function') {
  dialogPrototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    // As in the browsers, the event arrives after the dialog was closed.
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  };
}
if (!Object.getOwnPropertyDescriptor(dialogPrototype, 'open')) {
  Object.defineProperty(dialogPrototype, 'open', { get(this: HTMLDialogElement) { return this.hasAttribute('open'); }, configurable: true });
}

// A page without sub-pages.
class TestPage extends HTMLElement { }
class TestLeaf extends HTMLElement { }
class TestOther extends HTMLElement { }
class TestDialog extends HTMLElement { }
class Test404 extends HTMLElement { }
class TestCustom404 extends HTMLElement { }

// A page that hosts sub-pages, declaring the container for them.
class TestHost extends HTMLElement {
  containerCalls = 0;
  declareSubContainer(): HTMLElement | null {
    this.containerCalls++;
    return this.querySelector('div.sub');
  }
  connectedCallback() {
    if (this.querySelector('div.sub')) return;
    const sub = document.createElement('div');
    sub.className = 'sub';
    this.appendChild(sub);
  }
}
class TestHostB extends TestHost { }

// A page that says it has a container, but it has none.
class TestClosed extends HTMLElement {
  declareSubContainer(): HTMLElement | null { return null; }
}

// A page that records how its attributes are set.
class TestObserved extends HTMLElement {
  static observedAttributes = ['nav-data', 'a', 'b', 'own'];
  changes: string[] = [];
  attributesWhenConnected: string[] = [];
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    this.changes.push(`${name}:${oldValue}->${newValue}`);
  }
  connectedCallback() {
    this.attributesWhenConnected = this.getAttributeNames();
  }
}

const elements: Record<string, CustomElementConstructor> = {
  'test-page': TestPage,
  'test-leaf': TestLeaf,
  'test-other': TestOther,
  'test-dialog': TestDialog,
  'page-404': Test404,
  'test-custom-404': TestCustom404,
  'test-host': TestHost,
  'test-host-b': TestHostB,
  'test-closed': TestClosed,
  'test-observed': TestObserved
};
for (const [name, constructor] of Object.entries(elements)) {
  if (!customElements.get(name)) customElements.define(name, constructor);
}

///////////////////
///   HELPERS   ///
///////////////////

let Navigator: typeof NavigatorClass;
let helpers: typeof import('library/lib-fe/helper/dom');

/** The listeners the Navigator adds to the window; they are removed after each test, as every test has its own Navigator. */
const windowListeners: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(async () => {
  const addEventListener = window.addEventListener.bind(window);
  (vi.spyOn(window, 'addEventListener') as any).mockImplementation((type: string, listener: any, options?: any) => {
    windowListeners.push([type, listener]);
    addEventListener(type, listener, options);
  });

  document.head.innerHTML = '<meta name="description" content="Initial description">';
  document.body.innerHTML = '<main id="app"></main>';
  window.history.replaceState({}, '', '/');

  // Every test starts with a new Navigator, as it is a singleton.
  vi.resetModules();
  ({ Navigator } = await import('./navigator'));
  helpers = await import('library/lib-fe/helper/dom');
});

afterEach(() => {
  for (const [type, listener] of windowListeners) window.removeEventListener(type, listener);
  windowListeners.length = 0;
  vi.restoreAllMocks();
});

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function route(content: string, extra: Partial<Route> = {}): Route {
  return { content, title: `Title of ${content}`, description: `Description of ${content}`, pathType: 'WebPage', ...extra };
}

/** Some simple pages, and a page that hosts a sub-page. */
function standardRoutes(): Record<string, Route> {
  return {
    a: route('test-page', { title: 'A', description: 'About A' }),
    b: route('test-page', { title: 'B', description: 'About B' }),
    host: route('test-host', { title: 'Host', description: 'About the host' }),
    child: route('test-leaf', { title: 'Child', description: 'About the child' }),
  };
}

function start(path: string, routes: Record<string, Route> = standardRoutes(), aliases: Record<string, string> = {}) {
  window.history.replaceState({}, '', path);
  return Navigator.getInstance('https://example.test', '#app', routes, aliases);
}

const app = () => document.getElementById('app')!;
const find = <T extends HTMLElement = HTMLElement>(selector: string) => app().querySelector(selector) as T;
/** The names of the pages that are rendered, from the outside in (the containers of the hosts are left out). */
const rendered = () => [...app().querySelectorAll('*')].filter(element => element.localName !== 'div').map(element => element.localName);
const nav = (path: string) => Navigator.navigate(path);
const currentPath = () => window.location.pathname;
const metaContent = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
const canonical = () => document.querySelector('link[rel="canonical"]');
const structuredData = () => document.getElementById('navigator-structured-data');

const dialogElement = () => document.querySelector('body > dialog') as HTMLDialogElement;
const dialogContent = () => dialogElement().firstElementChild as HTMLElement | null;
/** The `n` of the dialog that is showing, which identifies it in the tests. */
const shownDialog = () => dialogContent()?.getAttribute('n') ?? null;

/** Follows a promise, to be able to tell if it is resolved yet. */
function track(promise: Promise<DialogResult>) {
  const tracked = { done: false, result: undefined as DialogResult | undefined };
  promise.then(result => { tracked.done = true; tracked.result = result; });
  return tracked;
}

const CANCELLED: DialogResult = { confirmed: false };

//////////////////
///   TESTS    ///
//////////////////

describe('Navigator', () => {
  describe('creation', () => {
    it('renders the route of the current path', () => {
      start('/a');
      expect(rendered()).toEqual(['test-page']);
      expect(document.title).toBe('A');
    });

    it('does not add a history entry for the initial load', () => {
      const length = window.history.length;
      start('/a');
      expect(window.history.length).toBe(length);
    });

    it('renders the target of an alias, without changing the address', () => {
      start('/', standardRoutes(), { '/': '/b' });
      expect(rendered()).toEqual(['test-page']);
      expect(document.title).toBe('B');
      expect(currentPath()).toBe('/');
    });

    it('supports aliases for any path', () => {
      start('/old', standardRoutes(), { '/old': '/b' });
      expect(document.title).toBe('B');
    });

    it('ignores a trailing slash', () => {
      start('/a/');
      expect(document.title).toBe('A');
    });

    it('renders nothing for the root path when there is no alias', () => {
      start('/');
      expect(app().childElementCount).toBe(0);
    });

    it('is a singleton', () => {
      const navigator = start('/a');
      expect(Navigator.getInstance('https://other.test', '#app', {}, {})).toBe(navigator);
    });

    it('creates one dialog element in the body', () => {
      start('/a');
      expect(document.querySelectorAll('dialog')).toHaveLength(1);
      expect(dialogElement().parentElement).toBe(document.body);
    });

    it('does nothing when the container of the app does not exist', () => {
      window.history.replaceState({}, '', '/a');
      expect(() => Navigator.getInstance('https://example.test', '#missing', standardRoutes(), {})).not.toThrow();
      expect(() => nav('/b')).not.toThrow();
      expect(currentPath()).toBe('/a');
      expect(app().childElementCount).toBe(0);
    });

    it('does not change the routes of the app when routes are added', () => {
      const routes = standardRoutes();
      start('/a', routes);
      Navigator.addRoute('added', route('test-page'));
      expect(routes).not.toHaveProperty('added');
    });
  });

  describe('before it is created', () => {
    it('warns and does nothing', async () => {
      const { Logger } = await import('library/lib/services/logger');
      Logger.getInstance().setLevel('warn');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });

      nav('/a');
      Navigator.addRoute('x', route('test-page'));
      Navigator.notFound();
      Navigator.setMetadata({ title: 'Nope' });
      expect(warn).toHaveBeenCalledTimes(4);
      expect(await Navigator.dialog('test-dialog')).toEqual(CANCELLED);
      expect(warn).toHaveBeenCalledTimes(5);

      expect(document.title).toBe('');
      expect(currentPath()).toBe('/');
    });
  });

  describe('not found', () => {
    it('renders the built-in 404 page for an unknown path', () => {
      start('/nope');
      expect(rendered()).toEqual(['page-404']);
      expect(document.title).toBe('404 - Page not found');
    });

    it('renders the 404 route of the app when there is one', () => {
      start('/nope', { ...standardRoutes(), '404': route('test-custom-404', { title: 'Missing' }) });
      expect(rendered()).toEqual(['test-custom-404']);
      expect(document.title).toBe('Missing');
    });

    it('treats a visit to the 404 route as not found', () => {
      start('/404', { ...standardRoutes(), '404': route('test-custom-404') });
      expect(metaContent('robots')).toBe('noindex');
      expect(canonical()).toBeNull();
    });

    it('can be left again', () => {
      start('/nope');
      nav('/a');
      expect(rendered()).toEqual(['test-page']);
    });

    it('does not treat names of Object.prototype as routes', () => {
      start('/a');
      for (const path of ['/constructor', '/__proto__', '/toString', '/hasOwnProperty', '/valueOf']) {
        nav(path);
        expect(rendered(), path).toEqual(['page-404']);
      }
    });

    it('shows the 404 page over the whole page when the path is deeper than the page can host', () => {
      start('/a/deeper');
      expect(app().childElementCount).toBe(1);
      expect(app().firstElementChild!.localName).toBe('page-404');
      expect(document.title).toBe('404 - Page not found');
    });

    it('recovers after a path that was too deep', () => {
      start('/a/deeper');
      nav('/a');
      expect(rendered()).toEqual(['test-page']);
      expect(document.title).toBe('A');
    });

    it('shows the 404 page when the container of a page is not available', () => {
      start('/closed/x', { closed: route('test-closed') });
      expect(app().firstElementChild!.localName).toBe('page-404');
    });

    it('shows the 404 page inside the container for an unknown sub-page', () => {
      start('/host/unknown');
      expect(rendered()).toEqual(['test-host', 'page-404']);
      expect(find('test-host').querySelector('page-404')).not.toBeNull();
      expect(document.title).toBe('404 - Page not found');
    });

    it('keeps the 404 page that is already shown for another unknown sub-page', () => {
      start('/host/unknown');
      const notFound = find('page-404');
      nav('/host/other-unknown');
      expect(find('page-404')).toBe(notFound);
    });

    it('replaces the 404 page of a sub-page when the sub-page exists', () => {
      start('/host/unknown');
      nav('/host/child');
      expect(rendered()).toEqual(['test-host', 'test-leaf']);
    });
  });

  describe('navigation', () => {
    it('renders the new page and adds a history entry', () => {
      start('/a');
      const length = window.history.length;
      nav('/b');
      expect(rendered()).toEqual(['test-page']);
      expect(document.title).toBe('B');
      expect(currentPath()).toBe('/b');
      expect(window.history.length).toBe(length + 1);
    });

    it('does not change the address when asked not to push the state', () => {
      start('/a');
      Navigator.navigate('/b', false);
      expect(document.title).toBe('B');
      expect(currentPath()).toBe('/a');
    });

    it('stores the state data in the history entry', () => {
      start('/a');
      Navigator.navigate('/b', true, { scroll: 5 });
      expect(window.history.state).toEqual({ scroll: 5 });
    });

    it('replaces the history entry when navigating to the current path', () => {
      start('/a');
      const length = window.history.length;
      Navigator.navigate('/a', true, { visit: 2 });
      expect(window.history.length).toBe(length);
      expect(window.history.state).toEqual({ visit: 2 });
    });

    it('navigates to the target of an alias', () => {
      start('/b', standardRoutes(), { '/': '/a' });
      nav('/');
      expect(currentPath()).toBe('/a');
      expect(document.title).toBe('A');
    });

    it('ignores a trailing slash', () => {
      start('/a');
      nav('/b/');
      expect(currentPath()).toBe('/b');
    });

    it('keeps the elements when navigating to the page that is already shown', () => {
      start('/host/child');
      const host = find('test-host');
      const child = find('test-leaf');
      nav('/host/child');
      expect(find('test-host')).toBe(host);
      expect(find('test-leaf')).toBe(child);
    });

    it('replaces the element when navigating to another page', () => {
      start('/a');
      const old = find('test-page');
      nav('/b');
      expect(find('test-page')).not.toBe(old);
      expect(old.isConnected).toBe(false);
    });

    it('navigates through the navigation event', () => {
      start('/a');
      helpers.emitNavigationEvent(document.body, '/b');
      expect(document.title).toBe('B');
      expect(currentPath()).toBe('/b');
    });

    it('stores the state data of the navigation event', () => {
      start('/a');
      helpers.emitNavigationEvent(document.body, '/b', { from: 'test' });
      expect(window.history.state).toEqual({ from: 'test' });
    });

    it('navigates when the browser goes back or forward, without adding a history entry', () => {
      start('/a');
      window.history.pushState({}, '', '/b');
      const length = window.history.length;
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(document.title).toBe('B');
      expect(window.history.length).toBe(length);
    });

    it('goes back through the history of the browser', () => {
      start('/a');
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => { });
      Navigator.back();
      expect(back).toHaveBeenCalledOnce();
    });

    it('follows a link without the browser loading the page', () => {
      start('/a');
      const link = document.createElement('a');
      document.body.appendChild(link);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const stop = vi.spyOn(event, 'stopImmediatePropagation');

      Navigator.followLink(link, '/b', event);

      expect(event.defaultPrevented).toBe(true);
      expect(stop).toHaveBeenCalled();
      expect(currentPath()).toBe('/b');
      expect(document.title).toBe('B');
    });
  });

  describe('sub-pages', () => {
    const routes = () => ({
      ...standardRoutes(),
      'host/child': route('test-leaf', { title: 'Exact child' }),
      other: route('test-host-b', { title: 'Other host' }),
      leaf: route('test-leaf', { title: 'Leaf' }),
    });

    it('renders each part of the path in the container of the previous one', () => {
      start('/host/child', routes());
      expect(rendered()).toEqual(['test-host', 'test-leaf']);
      expect(find('test-leaf').parentElement).toBe(find('test-host').querySelector('div.sub'));
    });

    it('uses the metadata of the last part of the path', () => {
      start('/host/child', routes());
      expect(document.title).toBe('Exact child');
    });

    it('keeps the page when a sub-page is added', () => {
      start('/host', routes());
      const host = find('test-host');
      nav('/host/leaf');
      expect(find('test-host')).toBe(host);
      expect(rendered()).toEqual(['test-host', 'test-leaf']);
    });

    it('removes the sub-page when the path gets shorter, and keeps the page', () => {
      start('/host/leaf', routes());
      const host = find('test-host');
      nav('/host');
      expect(find('test-host')).toBe(host);
      expect(rendered()).toEqual(['test-host']);
      expect(document.title).toBe('Host');
    });

    it('removes all the sub-pages when the path gets shorter by more than one', () => {
      start('/host/child', routes());
      nav('/host');
      expect(host().querySelector('div.sub')!.childElementCount).toBe(0);
    });

    it('replaces a sub-page with another one', () => {
      start('/host/leaf', routes());
      const leaf = find('test-leaf');
      nav('/host/child');
      expect(rendered()).toEqual(['test-host', 'test-leaf']);
      expect(find('test-leaf')).not.toBe(leaf);
    });

    it('replaces the sub-pages when the page above them is replaced', () => {
      start('/host/leaf', routes());
      const leaf = find('test-leaf');
      nav('/other/leaf');
      expect(rendered()).toEqual(['test-host-b', 'test-leaf']);
      expect(find('test-leaf')).not.toBe(leaf);
      expect(leaf.isConnected).toBe(false);
      expect(find('test-leaf').closest('test-host-b')).not.toBeNull();
    });

    it('asks for the container only when it is needed', () => {
      start('/host', routes());
      expect(host().containerCalls).toBe(0); // the last part of the path does not need one

      nav('/host/leaf');
      expect(host().containerCalls).toBe(1); // to render the sub-page

      nav('/host');
      expect(host().containerCalls).toBe(2); // to remove the sub-page

      nav('/host');
      expect(host().containerCalls).toBe(2); // there is nothing to remove
    });

    const host = () => find<TestHost>('test-host');
  });

  describe('route matching', () => {
    const routes = (): Record<string, Route> => ({
      product: route('test-host', { title: 'Products' }),
      'product/:id': route('test-observed', { title: 'Product' }),
      'product/new': route('test-leaf', { title: 'New product' }),
      shop: route('test-host', { title: 'Shop' }),
      'shop/:shopId': route('test-host-b', { title: 'Shop with id' }),
      'shop/:shopId/:itemId': route('test-observed', { title: 'Item' }),
      'shop/:shopId/edit': route('test-leaf', { title: 'Edit shop' }),
      host: route('test-host', { title: 'Host' }),
      'host/child': route('test-leaf', { title: 'Exact child' }),
      'host/:id': route('test-observed', { title: 'Host item' }),
      child: route('test-page', { title: 'Flat child' }),
      leaf: route('test-leaf', { title: 'Flat leaf' }),
    });
    const params = (selector: string) => JSON.parse(find(selector).getAttribute('nav-data')!).params;

    it('matches a parameter and gives it to the page', () => {
      start('/product/42', routes());
      expect(rendered()).toEqual(['test-host', 'test-observed']);
      expect(params('test-observed')).toEqual({ id: '42' });
      expect(document.title).toBe('Product');
    });

    it('matches several parameters, each page getting the ones of its own route', () => {
      start('/shop/7/9', routes());
      expect(rendered()).toEqual(['test-host', 'test-host-b', 'test-observed']);
      expect(params('test-host-b')).toEqual({ shopId: '7' });
      expect(params('test-observed')).toEqual({ shopId: '7', itemId: '9' });
    });

    it('prefers a static path over a path with parameters', () => {
      start('/product/new', routes());
      expect(rendered()).toEqual(['test-host', 'test-leaf']);
      expect(document.title).toBe('New product');
    });

    it('prefers the path with the fewest parameters', () => {
      start('/shop/7/edit', routes());
      expect(find('test-leaf')).not.toBeNull();
      expect(document.title).toBe('Edit shop');

      nav('/shop/7/other');
      expect(document.title).toBe('Item');
    });

    it('prefers a full path over the name of a segment', () => {
      start('/host/child', routes());
      expect(document.title).toBe('Exact child');
    });

    it('prefers a path with parameters over the name of a segment', () => {
      start('/host/leaf', routes());
      expect(rendered()).toEqual(['test-host', 'test-observed']);
      expect(params('test-observed')).toEqual({ id: 'leaf' });
    });

    it('matches the name of a segment at any depth', () => {
      const withoutParameters = routes();
      delete withoutParameters['product/:id'];

      start('/product/leaf', withoutParameters);

      expect(rendered()).toEqual(['test-host', 'test-leaf']);
      expect(document.title).toBe('Flat leaf');
    });

    it('does not match a path with parameters at another depth, or under another page', () => {
      start('/42', routes());
      expect(rendered()).toEqual(['page-404']);

      nav('/host/a/b');
      expect(find('page-404')).not.toBeNull();

      nav('/shop/7/9/10');
      expect(find('page-404')).not.toBeNull();
    });

    it('decodes the values of the parameters', () => {
      start('/product/a%20b%2Fc', routes());
      expect(params('test-observed')).toEqual({ id: 'a b/c' });
    });

    it('does not match a value that is not encoded correctly', () => {
      start('/product/%E0%A4%A', routes());
      expect(rendered()).toEqual(['test-host', 'page-404']);
    });

    it('matches routes that are added later', () => {
      start('/late/5', routes());
      expect(rendered()).toEqual(['page-404']);

      Navigator.addRoute('late', route('test-host', { title: 'Late' }));
      expect(rendered()).toEqual(['test-host', 'page-404']); // the page exists now, but not yet the sub-page

      Navigator.addRoute('late/:id', route('test-observed', { title: 'Late item' }));
      expect(rendered()).toEqual(['test-host', 'test-observed']);
      expect(params('test-observed')).toEqual({ id: '5' });
    });
  });

  describe('resolving routes', () => {
    it('lets the route override its data, and keeps the rest of the route', () => {
      start('/product/42', {
        product: route('test-host'),
        'product/:id': route('test-observed', {
          description: 'Static description',
          resolve: ({ id }) => ({ title: `Product ${id}`, attributes: { a: id }, navData: { extra: true } })
        })
      });

      expect(document.title).toBe('Product 42');
      expect(metaContent('description')).toBe('Static description');
      expect(find('test-observed').getAttribute('a')).toBe('42');
      expect(JSON.parse(find('test-observed').getAttribute('nav-data')!)).toEqual({ extra: true, params: { id: '42' } });
    });

    it('does not let the route override the parameters', () => {
      start('/product/42', {
        product: route('test-host'),
        'product/:id': route('test-observed', { resolve: () => ({ navData: { params: 'something else' } }) })
      });
      expect(JSON.parse(find('test-observed').getAttribute('nav-data')!).params).toEqual({ id: '42' });
    });

    it('gives the parameters to the resolver as they are in the path, decoded', () => {
      const resolve = vi.fn(() => ({}));
      start('/product/a%20b', { product: route('test-host'), 'product/:id': route('test-observed', { resolve }) });
      expect(resolve).toHaveBeenCalledWith({ id: 'a b' });
    });

    it('resolves static routes too, without parameters', () => {
      const resolve = vi.fn(() => ({ title: 'Resolved' }));
      start('/a', { a: route('test-observed', { resolve }) });
      expect(resolve).toHaveBeenCalledWith({});
      expect(document.title).toBe('Resolved');
      expect(find('test-observed').hasAttribute('nav-data')).toBe(false);
    });

    it('shows the 404 page when the resolver returns null', () => {
      start('/product/abc', {
        product: route('test-host'),
        'product/:id': route('test-observed', { resolve: ({ id }) => /^\d+$/.test(id) ? {} : null })
      });
      expect(rendered()).toEqual(['test-host', 'page-404']);
      expect(metaContent('robots')).toBe('noindex');
      expect(canonical()).toBeNull();

      nav('/product/42');
      expect(rendered()).toEqual(['test-host', 'test-observed']);
    });

    it('shows the 404 page, and logs the error, when the resolver throws', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => { });
      start('/a', {
        a: route('test-page', { resolve: () => { throw new Error('resolver failed'); } })
      });
      expect(rendered()).toEqual(['page-404']);
      expect(error).toHaveBeenCalled();
    });
  });

  describe('updating pages in place', () => {
    const routes = (extra: Partial<Route> = {}): Record<string, Route> => ({
      product: route('test-host'),
      'product/:id': route('test-observed', {
        resolve: ({ id }) => {
          const attributes: Record<string, string> = id === '1' ? { a: '1', b: '2' } : { a: '1' };
          return { attributes };
        },
        ...extra
      })
    });
    const observed = () => find<TestObserved>('test-observed');

    it('sets the attributes before the page is added to the document', () => {
      start('/product/1', routes());
      expect(observed().attributesWhenConnected).toEqual(['nav-data', 'a', 'b']);
    });

    it('keeps the element when only the parameters change, and updates its attributes', () => {
      start('/product/1', routes());
      const element = observed();

      nav('/product/2');

      expect(observed()).toBe(element);
      expect(JSON.parse(element.getAttribute('nav-data')!).params).toEqual({ id: '2' });
    });

    it('touches only the attributes that changed, and removes the ones that are gone', () => {
      start('/product/1', routes());
      const element = observed();
      element.changes.length = 0;

      nav('/product/2');

      expect(element.changes).toEqual([
        'b:2->null',
        'nav-data:{"params":{"id":"1"}}->{"params":{"id":"2"}}'
      ]);
      expect(element.hasAttribute('b')).toBe(false);
      expect(element.getAttribute('a')).toBe('1');
    });

    it('leaves the page alone when nothing changed', () => {
      start('/product/1', routes());
      const element = observed();
      element.changes.length = 0;

      nav('/product/1');

      expect(observed()).toBe(element);
      expect(element.changes).toEqual([]);
    });

    it('never removes attributes that the page set on itself', () => {
      start('/product/1', routes());
      observed().setAttribute('own', 'mine');

      nav('/product/2');

      expect(observed().getAttribute('own')).toBe('mine');
    });

    it('keeps the sub-pages of a page that is updated in place', () => {
      start('/shop/1/x', {
        shop: route('test-host'),
        'shop/:id': route('test-host-b'),
        'shop/:id/x': route('test-leaf'),
      });
      const shop = find('test-host-b');
      const sub = find('test-leaf');

      nav('/shop/2/x');

      expect(find('test-host-b')).toBe(shop);
      expect(find('test-leaf')).toBe(sub);
    });

    it('replaces the element when the route asks for it', () => {
      start('/product/1', routes({ rerender: true }));
      const element = observed();

      nav('/product/2');

      expect(observed()).not.toBe(element);
      expect(element.isConnected).toBe(false);
    });

    it('replaces the element when the page of the route changes', () => {
      start('/product/1', {
        product: route('test-host'),
        'product/:id': route('test-observed', { resolve: ({ id }) => ({ content: id === '1' ? 'test-observed' : 'test-leaf' }) })
      });
      expect(rendered()).toEqual(['test-host', 'test-observed']);

      nav('/product/2');

      expect(rendered()).toEqual(['test-host', 'test-leaf']);
    });

    it('replaces the element when a route is replaced by one with another page', () => {
      start('/a');
      Navigator.addRoute('a', route('test-leaf', { title: 'New A' }));
      expect(rendered()).toEqual(['test-page']); // nothing is re-rendered by adding a route

      nav('/a');
      expect(rendered()).toEqual(['test-leaf']);
    });
  });

  describe('metadata', () => {
    it('sets the title and the description', () => {
      start('/a');
      expect(document.title).toBe('A');
      expect(metaContent('description')).toBe('About A');
    });

    it('creates the description when the document has none', () => {
      document.head.innerHTML = '';
      start('/a');
      expect(metaContent('description')).toBe('About A');
      expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    });

    it('keeps the title and the description of the previous page when the page has none', () => {
      start('/a', { ...standardRoutes(), untitled: route('test-page', { title: '', description: '' }) });
      nav('/untitled');
      expect(document.title).toBe('A');
      expect(metaContent('description')).toBe('About A');
    });

    describe('canonical URL', () => {
      it('is set to the address of the page, and updated', () => {
        start('/host/child');
        expect(canonical()!.getAttribute('href')).toBe('https://example.test/host/child');

        nav('/a');
        expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
        expect(canonical()!.getAttribute('href')).toBe('https://example.test/a');
      });

      it('is removed for the 404 page', () => {
        start('/a');
        nav('/nope');
        expect(canonical()).toBeNull();
      });
    });

    describe('robots', () => {
      it('asks not to index the 404 page, and only that one', () => {
        start('/a');
        expect(metaContent('robots')).toBeUndefined();

        nav('/nope');
        expect(metaContent('robots')).toBe('noindex');
        expect(document.querySelector('meta[name="robots"]')!.hasAttribute('data-navigator')).toBe(true);

        nav('/a');
        expect(metaContent('robots')).toBeUndefined();
      });

      it('never touches the robots tag of the app', () => {
        document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="index,follow">');
        start('/a');
        nav('/nope');
        nav('/a');
        const tags = document.querySelectorAll('meta[name="robots"]');
        expect(tags).toHaveLength(1);
        expect(tags[0].getAttribute('content')).toBe('index,follow');
      });

      it('does not add the tag twice', () => {
        start('/nope');
        nav('/other-nope');
        expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
      });
    });

    describe('structured data', () => {
      it('describes the page', () => {
        start('/a');
        expect(JSON.parse(structuredData()!.textContent!)).toEqual({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'A',
          description: 'About A',
          url: 'https://example.test/a'
        });
        expect(structuredData()!.getAttribute('type')).toBe('application/ld+json');
      });

      it('is replaced on navigation, not added to', () => {
        start('/a');
        nav('/b');
        expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
        expect(JSON.parse(structuredData()!.textContent!).name).toBe('B');
      });

      it('is removed for the 404 page', () => {
        start('/a');
        nav('/nope');
        expect(structuredData()).toBeNull();
      });

      it('never touches the structured data of the app', () => {
        document.head.insertAdjacentHTML('beforeend', '<script type="application/ld+json" id="own">{"own":true}</script>');
        start('/a');
        nav('/nope');
        nav('/b');
        expect(document.getElementById('own')!.textContent).toBe('{"own":true}');
      });
    });

    describe('setMetadata()', () => {
      it('sets the title, the description and the structured data', () => {
        start('/a');
        Navigator.setMetadata({ title: 'Real title', description: 'Real description', structuredData: { custom: 1 } });
        expect(document.title).toBe('Real title');
        expect(metaContent('description')).toBe('Real description');
        expect(JSON.parse(structuredData()!.textContent!)).toEqual({ custom: 1 });
      });

      it('changes only what is given', () => {
        start('/a');
        Navigator.setMetadata({ title: 'Only the title' });
        expect(document.title).toBe('Only the title');
        expect(metaContent('description')).toBe('About A');
        expect(JSON.parse(structuredData()!.textContent!).name).toBe('A');
      });

      it('ignores an empty title or description', () => {
        start('/a');
        Navigator.setMetadata({ title: '', description: '' });
        expect(document.title).toBe('A');
        expect(metaContent('description')).toBe('About A');
      });

      it('removes the structured data when asked to', () => {
        start('/a');
        Navigator.setMetadata({ structuredData: null });
        expect(structuredData()).toBeNull();
      });

      it('is replaced by the metadata of the next navigation', () => {
        start('/a');
        Navigator.setMetadata({ title: 'Real title' });
        nav('/b');
        expect(document.title).toBe('B');
      });
    });
  });

  describe('notFound()', () => {
    it('replaces the whole page with the 404 page, keeping the address', () => {
      start('/host/child');
      Navigator.notFound();
      expect(rendered()).toEqual(['page-404']);
      expect(document.title).toBe('404 - Page not found');
      expect(metaContent('robots')).toBe('noindex');
      expect(canonical()).toBeNull();
      expect(structuredData()).toBeNull();
      expect(currentPath()).toBe('/host/child');
    });

    it('uses the 404 route of the app', () => {
      start('/a', { ...standardRoutes(), '404': route('test-custom-404') });
      Navigator.notFound();
      expect(rendered()).toEqual(['test-custom-404']);
    });

    it('can be left by navigating', () => {
      start('/a');
      Navigator.notFound();
      nav('/b');
      expect(rendered()).toEqual(['test-page']);
      expect(document.title).toBe('B');
      expect(metaContent('robots')).toBeUndefined();
    });

    it('does nothing when the container of the app does not exist', () => {
      window.history.replaceState({}, '', '/a');
      Navigator.getInstance('https://example.test', '#missing', standardRoutes(), {});
      expect(() => Navigator.notFound()).not.toThrow();
      expect(document.title).toBe('');
    });
  });

  describe('addRoute()', () => {
    it('adds a route that can be navigated to', () => {
      start('/a');
      Navigator.addRoute('added', route('test-leaf', { title: 'Added' }));
      nav('/added');
      expect(rendered()).toEqual(['test-leaf']);
      expect(document.title).toBe('Added');
    });

    it('resolves the current path again when the 404 page is shown, without adding a history entry', () => {
      start('/late');
      expect(rendered()).toEqual(['page-404']);
      const length = window.history.length;

      Navigator.addRoute('late', route('test-page', { title: 'Late' }));

      expect(rendered()).toEqual(['test-page']);
      expect(document.title).toBe('Late');
      expect(window.history.length).toBe(length);
      expect(currentPath()).toBe('/late');
    });

    it('does not resolve the current path again when the page shown exists', () => {
      const resolve = vi.fn(() => ({}));
      start('/a', { a: route('test-page', { resolve }) });
      expect(resolve).toHaveBeenCalledTimes(1);

      Navigator.addRoute('other', route('test-page'));

      expect(resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe('dialogs', () => {
    describe('showing', () => {
      beforeEach(() => { start('/a'); });

      it('shows the component with the data as attributes', () => {
        Navigator.dialog('test-dialog', { n: 1, s: 'hi', o: { k: [1, 2] } });
        expect(dialogContent()!.localName).toBe('test-dialog');
        expect(dialogContent()!.getAttribute('n')).toBe('1');
        expect(dialogContent()!.getAttribute('s')).toBe('"hi"'); // the values are JSON
        expect(dialogContent()!.getAttribute('o')).toBe('{"k":[1,2]}');
        expect(dialogElement().open).toBe(true);
      });

      it('shows a dialog without data', () => {
        Navigator.dialog('test-dialog');
        expect(dialogContent()!.attributes).toHaveLength(0);
      });

      it('resolves as confirmed, with the data of the dialog', async () => {
        const result = Navigator.dialog('test-dialog', { n: 1 });
        await helpers.emitDialogConfirmEvent(dialogContent()!, { ok: true });
        expect(await result).toEqual({ confirmed: true, data: { ok: true } });
        expect(dialogElement().open).toBe(false);
        expect(dialogContent()).toBeNull();
      });

      it('resolves as cancelled', async () => {
        const result = Navigator.dialog('test-dialog', { n: 1 });
        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(await result).toEqual(CANCELLED);
        expect(dialogElement().open).toBe(false);
      });

      it('resolves as cancelled when the user presses Esc', async () => {
        const result = Navigator.dialog('test-dialog', { n: 1 });
        dialogElement().dispatchEvent(new Event('cancel'));
        expect(await result).toEqual(CANCELLED);
        expect(dialogElement().open).toBe(false);
      });

      it('does not let the confirm and cancel events leave the dialog', async () => {
        const seen = vi.fn();
        window.addEventListener('confirm-dialog', seen);
        window.addEventListener('cancel-dialog', seen);

        Navigator.dialog('test-dialog', { n: 1 });
        await helpers.emitDialogConfirmEvent(dialogContent()!, 1);
        Navigator.dialog('test-dialog', { n: 2 });
        await helpers.emitDialogCancelEvent(dialogContent()!);

        expect(seen).not.toHaveBeenCalled();
      });

      it('ignores the confirm and cancel events when no dialog is showing', async () => {
        expect(() => {
          dialogElement().dispatchEvent(new CustomEvent('confirm-dialog', { detail: { data: 1 } }));
          dialogElement().dispatchEvent(new CustomEvent('cancel-dialog'));
          dialogElement().dispatchEvent(new Event('cancel'));
        }).not.toThrow();

        Navigator.dialog('test-dialog', { n: 1 });
        expect(shownDialog()).toBe('1');
      });

      it('counts a dialog that was closed in another way as cancelled', async () => {
        const first = track(Navigator.dialog('test-dialog', { n: 1 }));
        const second = track(Navigator.dialog('test-dialog', { n: 2 }));

        dialogElement().close(); // e.g. a form with `method="dialog"`
        await tick();

        expect(first.result).toEqual(CANCELLED);
        expect(shownDialog()).toBe('2');
        expect(second.done).toBe(false);
      });

      it('leaves the next dialog alone when the close event of the previous one arrives late', async () => {
        const first = track(Navigator.dialog('test-dialog', { n: 1 }));
        const second = track(Navigator.dialog('test-dialog', { n: 2 }));

        await helpers.emitDialogConfirmEvent(dialogContent()!, 'yes');
        await tick(); // the close event of the first dialog arrives now, while the second one is showing

        expect(first.result).toEqual({ confirmed: true, data: 'yes' });
        expect(second.done).toBe(false);
        expect(shownDialog()).toBe('2');
        expect(dialogElement().open).toBe(true);
      });

      it('skips a dialog that cannot be shown, and shows the ones behind it', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { });

        const invalid = Navigator.dialog('not a valid name', {});
        const next = Navigator.dialog('test-dialog', { n: 5 });

        expect(await invalid).toEqual(CANCELLED);
        expect(error).toHaveBeenCalled();
        expect(shownDialog()).toBe('5');
        await helpers.emitDialogConfirmEvent(dialogContent()!, 1);
        expect(await next).toEqual({ confirmed: true, data: 1 });
      });
    });

    describe('queue', () => {
      beforeEach(() => { start('/a'); });

      it('shows one dialog at a time, in the order they were requested', async () => {
        const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
        const order: string[] = [];
        for (const n of [1, 2, 3]) {
          Navigator.dialog('test-dialog', { n }).then(result => order.push(`${n}:${JSON.stringify(result)}`));
        }

        expect(shownDialog()).toBe('1');
        expect(document.querySelectorAll('dialog test-dialog')).toHaveLength(1);

        await helpers.emitDialogConfirmEvent(dialogContent()!, 'one');
        expect(shownDialog()).toBe('2');
        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(shownDialog()).toBe('3');
        await helpers.emitDialogConfirmEvent(dialogContent()!, 'three');
        await tick();

        expect(dialogContent()).toBeNull();
        expect(showModal).toHaveBeenCalledTimes(3);
        expect(order).toEqual([
          '1:{"confirmed":true,"data":"one"}',
          '2:{"confirmed":false}',
          '3:{"confirmed":true,"data":"three"}'
        ]);
      });

      it('does not mix up the results of dialogs that are requested together', async () => {
        const first = Navigator.dialog('test-dialog', { n: 1 });
        const second = Navigator.dialog('test-dialog', { n: 2 });
        await helpers.emitDialogConfirmEvent(dialogContent()!, 'a');
        await helpers.emitDialogConfirmEvent(dialogContent()!, 'b');
        expect(await first).toEqual({ confirmed: true, data: 'a' });
        expect(await second).toEqual({ confirmed: true, data: 'b' });
      });

      it('lets an identical request join the dialog that is showing', async () => {
        const first = track(Navigator.dialog('test-dialog', { n: 1 }));
        const joined = track(Navigator.dialog('test-dialog', { n: 1 }));

        expect(document.querySelectorAll('dialog test-dialog')).toHaveLength(1);
        await helpers.emitDialogConfirmEvent(dialogContent()!, 'ok');
        await tick();

        expect(first.result).toEqual({ confirmed: true, data: 'ok' });
        expect(joined.result).toEqual({ confirmed: true, data: 'ok' });
        expect(dialogContent()).toBeNull(); // it was not shown a second time
      });

      it('lets an identical request join a dialog that is waiting', async () => {
        Navigator.dialog('test-dialog', { n: 1 });
        const waiting = track(Navigator.dialog('test-dialog', { n: 2 }));
        const joined = track(Navigator.dialog('test-dialog', { n: 2 }));

        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(shownDialog()).toBe('2');
        await helpers.emitDialogConfirmEvent(dialogContent()!, 'ok');
        await tick();

        expect(waiting.result).toEqual({ confirmed: true, data: 'ok' });
        expect(joined.result).toEqual({ confirmed: true, data: 'ok' });
        expect(dialogContent()).toBeNull();
      });

      it('does not join requests of another component, or with other data', async () => {
        Navigator.dialog('test-dialog', { n: 1 });
        Navigator.dialog('test-dialog', { n: 1, extra: true });
        Navigator.dialog('test-page', { n: 1 });

        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(shownDialog()).toBe('1');
        expect(dialogContent()!.hasAttribute('extra')).toBe(true);
        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(dialogContent()!.localName).toBe('test-page');
      });

      it('shows a dialog that is requested again after the previous one closed', async () => {
        Navigator.dialog('test-dialog', { n: 1 });
        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(dialogContent()).toBeNull();

        Navigator.dialog('test-dialog', { n: 1 });
        expect(shownDialog()).toBe('1');
      });

      it('queues a dialog that is requested from the result of another one behind the ones that are waiting', async () => {
        Navigator.dialog('test-dialog', { n: 1 }).then(() => Navigator.dialog('test-dialog', { n: 3 }));
        Navigator.dialog('test-dialog', { n: 2 });

        await helpers.emitDialogConfirmEvent(dialogContent()!, 1);
        await tick();
        expect(shownDialog()).toBe('2');

        await helpers.emitDialogConfirmEvent(dialogContent()!, 2);
        expect(shownDialog()).toBe('3');
      });

      describe('when the user navigates', () => {
        it('cancels the dialogs that are waiting, and leaves the one that is showing', async () => {
          const active = track(Navigator.dialog('test-dialog', { n: 1 }));
          const waiting = track(Navigator.dialog('test-dialog', { n: 2 }));
          const joined = track(Navigator.dialog('test-dialog', { n: 2 }));

          nav('/b');
          await tick();

          expect(waiting.result).toEqual(CANCELLED);
          expect(joined.result).toEqual(CANCELLED);
          expect(active.done).toBe(false);
          expect(shownDialog()).toBe('1');

          await helpers.emitDialogConfirmEvent(dialogContent()!, 1);
          expect(dialogContent()).toBeNull(); // nothing is left to show
        });

        it('keeps the dialogs that are persistent', async () => {
          Navigator.dialog('test-dialog', { n: 1 });
          const stale = track(Navigator.dialog('test-dialog', { n: 2 }));
          const kept = track(Navigator.dialog('test-dialog', { n: 3 }, { persistent: true }));

          nav('/b');
          await tick();
          expect(stale.result).toEqual(CANCELLED);
          expect(kept.done).toBe(false);

          await helpers.emitDialogCancelEvent(dialogContent()!);
          expect(shownDialog()).toBe('3');
        });

        it('keeps the dialogs when the same path is navigated to again', async () => {
          Navigator.dialog('test-dialog', { n: 1 });
          const waiting = track(Navigator.dialog('test-dialog', { n: 2 }));

          nav('/a');
          await tick();

          expect(waiting.done).toBe(false);
        });

        it('keeps the dialogs when the current path is resolved again by a new route', async () => {
          Navigator.notFound();
          nav('/late');
          Navigator.dialog('test-dialog', { n: 1 });
          const waiting = track(Navigator.dialog('test-dialog', { n: 2 }));

          Navigator.addRoute('late', route('test-page'));
          await tick();

          expect(waiting.done).toBe(false);
        });
      });
    });

    describe('events', () => {
      beforeEach(() => { start('/a'); });

      it('shows the dialog and calls the confirm callback with the data', async () => {
        const confirm = vi.fn();
        const cancel = vi.fn();
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 }, confirm, cancel);
        expect(shownDialog()).toBe('1');

        await helpers.emitDialogConfirmEvent(dialogContent()!, { ok: true });
        await tick();

        expect(confirm).toHaveBeenCalledWith({ ok: true });
        expect(cancel).not.toHaveBeenCalled();
      });

      it('calls the cancel callback when cancelled', async () => {
        const confirm = vi.fn();
        const cancel = vi.fn();
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 }, confirm, cancel);

        await helpers.emitDialogCancelEvent(dialogContent()!);
        await tick();

        expect(cancel).toHaveBeenCalledOnce();
        expect(confirm).not.toHaveBeenCalled();
      });

      it('works without callbacks', async () => {
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 });
        await helpers.emitDialogConfirmEvent(dialogContent()!, 1);
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 2 });
        await helpers.emitDialogCancelEvent(dialogContent()!);
        await tick();
        expect(dialogContent()).toBeNull();
      });

      it('shows a dialog without data', async () => {
        document.body.dispatchEvent(new CustomEvent('open-dialog', { bubbles: true, detail: { element: 'test-dialog' } }));
        expect(dialogContent()!.localName).toBe('test-dialog');
        expect(dialogContent()!.attributes).toHaveLength(0);
      });

      it('does not let the event leave the Navigator', async () => {
        const seen = vi.fn();
        window.addEventListener('open-dialog', seen);
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 });
        expect(seen).not.toHaveBeenCalled();
      });

      it('queues the dialogs together with the ones requested with promises', async () => {
        const confirm = vi.fn();
        Navigator.dialog('test-dialog', { n: 1 });
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 2 }, confirm);
        expect(shownDialog()).toBe('1');

        await helpers.emitDialogCancelEvent(dialogContent()!);
        expect(shownDialog()).toBe('2');
        await helpers.emitDialogConfirmEvent(dialogContent()!, 'two');
        await tick();
        expect(confirm).toHaveBeenCalledWith('two');
      });

      it('calls the callbacks of all the identical requests', async () => {
        const first = vi.fn();
        const second = vi.fn();
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 }, first);
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 }, second);

        await helpers.emitDialogConfirmEvent(dialogContent()!, 'ok');
        await tick();

        expect(first).toHaveBeenCalledWith('ok');
        expect(second).toHaveBeenCalledWith('ok');
      });

      it('cancels the waiting dialogs on navigation, calling their cancel callbacks, unless they are persistent', async () => {
        const staleCancel = vi.fn();
        const keptCancel = vi.fn();
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 });
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 2 }, undefined, staleCancel);
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 3 }, undefined, keptCancel, { persistent: true });

        nav('/b');
        await tick();

        expect(staleCancel).toHaveBeenCalledOnce();
        expect(keptCancel).not.toHaveBeenCalled();
      });

      it('waits for an asynchronous callback, and logs one that fails without blocking the dialogs', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { });
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 1 }, async () => {
          await tick();
          throw new Error('callback failed');
        });
        await helpers.emitDialogEvent(document.body, 'test-dialog', { n: 2 });

        await helpers.emitDialogConfirmEvent(dialogContent()!, 1);
        expect(shownDialog()).toBe('2');
        await tick(); await tick();

        expect(error).toHaveBeenCalled();
      });
    });
  });
});
