import { Logger } from "library/lib/services/logger";
import { Listener } from "library/lib-fe/types/state";

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export class Observable {
  private name: string;
  private value: any;
  // { 'subscriber': { 'watched-path': callback } }
  private listeners: Map<string, Map<string, Listener>>;
  private default: boolean;

  constructor(name: string, value: any, isDefault: boolean) {
    this.name = name;
    this.value = structuredClone(value);
    this.default = isDefault;
    this.listeners = new Map();
  }

  /**
   * Get a copy of the observable's value, or of a part of it.
   * @param {string} path: the observable's name, optionally followed by a path; e.g. "user", "user.address.city"
   * @returns the value, or undefined if the final property does not exist; throws if the path goes through a non-object
   */
  get(path?: string): any {
    if (!path || path === this.name) return structuredClone(this.value);

    const parts: string[] = path.split(".");
    let v: any = this.value;
    for (let i = 1; i < parts.length; i++) {
      v = Observable.child(v, parts[i]);
    }
    return structuredClone(v);
  }

  /**
   * Set the observable's value, or a part of it, and notify the relevant listeners.
   * @param {string} updatePath: the observable's name, optionally followed by a path; e.g. "user", "user.address.city"
   * @param {any} value: the new value (copied; to guard against silent updates)
   */
  set(updatePath: string, value: any) {
    const cloned: any = structuredClone(value);

    if (updatePath === this.name) {
      // update the full value
      this.value = cloned;
      this.notifyListeners(this.name);
      return;
    }

    const parts: string[] = updatePath.split(".");
    const last: string = parts[parts.length - 1];
    Observable.assertSafeKey(last);

    let wrapper: any = this.value;
    for (let i = 1; i < parts.length - 1; i++) {
      wrapper = Observable.child(wrapper, parts[i]);
    }
    if (typeof wrapper !== "object" || wrapper === null) {
      throw new Error(`Cannot set property '${last}' of ${wrapper === null ? "null" : typeof wrapper}`);
    }

    wrapper[last] = cloned;
    this.notifyListeners(updatePath);
  }

  isDefault(): boolean {
    return this.default;
  }

  invalidateDefaultStatus(): void {
    this.default = false;
  }

  subscribe(subscriber: string, listeners: Record<string, Listener>) {
    let own: Map<string, Listener> | undefined = this.listeners.get(subscriber);
    if (!own) {
      own = new Map();
      this.listeners.set(subscriber, own);
    }

    for (const [path, listener] of Object.entries(listeners)) {
      own.set(path, listener);
    }
  }

  unsubscribe(subscriber: string, paths?: string[]) {
    const own: Map<string, Listener> | undefined = this.listeners.get(subscriber);
    if (!own) return;

    if (!paths) {
      this.listeners.delete(subscriber);
      return;
    }

    paths.forEach((p) => own.delete(p));
    if (own.size === 0) this.listeners.delete(subscriber);
  }

  private notifyListeners(updatedPath: string) {
    // iterate over copies, so that listeners can (un)subscribe while being notified
    for (const [sub, listeners] of [...this.listeners]) {
      for (const [watchedPath, listener] of [...listeners]) {
        if (!Observable.pathsOverlap(updatedPath, watchedPath)) continue;

        // one failing listener must not prevent the others from being notified
        try {
          listener(sub, watchedPath, this.get(watchedPath));
        }
        catch (e) {
          Logger.getInstance().error(`Listener '${watchedPath}' of '${sub}' failed:`, e);
        }
      }
    }
  }

  /** Two paths overlap if they are equal or one is an ancestor of the other. */
  private static pathsOverlap(a: string, b: string): boolean {
    return a === b || a.startsWith(b + ".") || b.startsWith(a + ".");
  }

  private static child(parent: any, key: string): any {
    if (typeof parent !== "object" || parent === null) {
      throw new Error(`Cannot read property '${key}' of ${parent === null ? "null" : typeof parent}`);
    }
    return Object.hasOwn(parent, key) ? parent[key] : undefined;
  }

  private static assertSafeKey(key: string) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden property name '${key}'`);
  }
}
