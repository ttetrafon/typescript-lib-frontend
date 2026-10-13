import { cloneDeep } from "lodash";
import { Listener } from "../types";

export class Observable {
  private name: string;
  private value: any;
  // { 'subscriber': { 'watched-path': callback } }
  private listeners: Record<string, Record<string, Listener>>;

  constructor(name: string, value: any) {
    this.name = name;
    this.value = value;
    this.listeners = {};
  }

  get(path?: string): any {
    let v: any = this.value;
    if (!path) return cloneDeep(v);

    if (path !== this.name) {
      const parts: string[] = path.split(".");
      for (let i = 1; i < parts.length; i++) {
        if (v === null || v === undefined) {
          throw new Error(`Cannot read property '${parts[i]}' of ${v}`);
        }
        if (typeof v !== 'object' || v === null) {
          throw new Error(`Cannot read property '${parts[i]}' of ${typeof v}`);
        }
        v = (v as Record<string, any>)[parts[i]];
      }
    }
    return cloneDeep(v);
  }

  set(updatePath: string, value: any) {
    if (updatePath === this.name) {
      // update the full value
      this.value = value;
      this.notifyListeners(this.name);
      return;
    }

    const parts: string[] = updatePath.split(".");
    const l: number = parts.length;
    let wrapper: any = this.value;
    for (let i = 2; i < l - 1; i++) {
      if (wrapper === null || wrapper === undefined) {
        throw new Error(`Cannot read property '${parts[i]}' of ${wrapper}`);
      }
      if (typeof wrapper !== 'object' || wrapper === null) {
        throw new Error(`Cannot read property '${parts[i]}' of ${typeof wrapper}`);
      }
      wrapper = (wrapper as Record<string, any>)[parts[i]];
    }
    wrapper[parts[1]] = value;
    this.notifyListeners(updatePath);
  }

  async subscribe(subscriber: string, listeners: Record<string, Listener>) {
    if (!this.listeners.hasOwnProperty(subscriber)) {
      this.listeners[subscriber] = {};
    }

    for (const [path, listener] of Object.entries(listeners)) {
      this.listeners[subscriber][path] = listener;
    }
  }

  async unsubscribe(subscriber: string, paths?: string[]) {
    if (!this.listeners[subscriber]) return;

    if (!paths) {
      delete this.listeners[subscriber];
      return;
    }

    paths.forEach((p) => {
      delete this.listeners[subscriber][p];
    });

    if (Object.keys(this.listeners[subscriber]).length === 0) delete this.listeners[subscriber];
  }

  private notifyListeners(updatedPath: string) {
    // get the actual value
    const v: any = this.get(updatedPath);
    // notify subscribers if they indeed follow the path!
    for (const [sub, listeners] of Object.entries(this.listeners)) {
      for (const [watchedPath, listener] of Object.entries(listeners)) {
        if (
          // if either of the paths is the root, notify
          (!updatedPath.includes(".") || !updatedPath.includes("."))
          // if either of the paths is a subpath of the other, notify
          || (updatedPath.includes(watchedPath) || watchedPath.includes(updatedPath))
        ) listener(sub, watchedPath, this.get(watchedPath));
      }
    }
  }
}
