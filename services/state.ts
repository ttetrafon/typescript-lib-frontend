import { Logger } from "library/lib/services/logger";
import { BroadcastMessage, BroadcastMessageType, CreateInternalOptions, Listener, ObservableOptions, StateSnapshot } from "library/lib-fe/types/state";
import { Observable } from "library/lib-fe/wrappers/Observable";
import { LOCAL_STORAGE_STATE_KEY } from "library/lib-fe/data/constants";
import { uuidv4 } from "library/lib/security/uuid";

/** How long a new tab waits for another tab to send the current state, before it gives up and starts fresh. */
const STATE_REQUEST_TIMEOUT_MS: number = 1000;

const MESSAGE_TYPES: ReadonlySet<string> = new Set<BroadcastMessageType>([
  "request-state", "receive-state", "create-observable", "update-observable", "remove-observable"
]);

/** Messages that change observables; they are held back while the initial state is being requested, and replayed after it arrives. */
const BUFFERED_MESSAGE_TYPES: ReadonlySet<string> = new Set<BroadcastMessageType>([
  "create-observable", "update-observable", "remove-observable"
]);

const DEFAULT_OPTIONS: ObservableOptions = { broadcastCreation: true, localStorage: false };

export class State {
  static #instance: State;
  private logger: Logger;

  private appName: string;
  private senderId: string;
  private stateInitiatedAt: number;

  // initial state synchronisation with other tabs
  private requestedState: boolean = false;
  private requestTimer: ReturnType<typeof setTimeout> | undefined;
  private bufferedMessages: BroadcastMessage[] = [];
  private stateReady: Promise<void>;
  private resolveStateReady!: () => void;

  private observables: Map<string, Observable> = new Map();
  private waiters: Map<string, Set<() => void>> = new Map();
  private channel: BroadcastChannel;

  private keysInLocalStorage: Set<string> = new Set();

  private constructor(appName: string) {
    this.logger = Logger.getInstance();

    this.appName = appName;
    this.senderId = uuidv4();
    this.stateInitiatedAt = Date.now();
    this.stateReady = new Promise<void>((resolve) => { this.resolveStateReady = resolve; });
    this.loadLocalStorageKeys();

    this.channel = new BroadcastChannel(this.appName);
    this.channel.onmessage = (event: MessageEvent) => this.receiveBroadcastedMessage(event);

    // ask the other tabs (if any) for the current state, and give up if nobody answers
    this.requestedState = true;
    this.requestTimer = setTimeout(() => this.finishStateRequest(), STATE_REQUEST_TIMEOUT_MS);
    this.broadcastMessage({
      type: "request-state",
      time: this.stateInitiatedAt,
      name: "state",
      data: null,
      options: {}
    });
  }

  public static getInstance(appName: string): State {
    if (!State.#instance) {
      State.#instance = new State(appName);
    }
    else if (State.#instance.appName !== appName) {
      State.#instance.logger.warn(`State is already initialised for '${State.#instance.appName}'; ignoring '${appName}'.`);
    }
    return State.#instance;
  }

  ///////////////
  //   STATE   //
  ///////////////

  /** Collect all observables with real values (not the placeholders created by subscribers) for a new tab. */
  private collectState(): StateSnapshot {
    this.logger.debug(`---> State.collectState()`);
    const state: StateSnapshot = {};
    for (const [name, obs] of this.observables) {
      if (obs.isDefault()) continue;
      state[name] = {
        value: obs.get(name),
        localStorage: this.keysInLocalStorage.has(name)
      };
    }
    return state;
  }

  /** Apply the received state (if any), then replay the messages that arrived in the meantime. */
  private finishStateRequest(snapshot?: StateSnapshot) {
    if (!this.requestedState) return;

    this.requestedState = false;
    clearTimeout(this.requestTimer);

    if (snapshot) {
      for (const [name, entry] of Object.entries(snapshot)) {
        try {
          if (!State.isValidName(name) || typeof entry !== "object" || entry === null || !("value" in entry)) continue;
          this.storeRemoteValue(name, entry.value, entry.localStorage === true);
        }
        catch (e) {
          this.logger.error(`Failed to apply the received state of '${name}':`, e);
        }
      }
    }

    const buffered: BroadcastMessage[] = this.bufferedMessages;
    this.bufferedMessages = [];
    buffered.forEach((msg) => this.handleMessage(msg));

    this.resolveStateReady();
  }

  ////////////////////
  //   BROADCASTS   //
  ////////////////////

  private broadcastMessage(msg: Omit<BroadcastMessage, "senderId" | "time"> & { time?: number }) {
    this.logger.debug(`---> State.broadcastMessage()`, msg);
    try {
      this.channel.postMessage({ ...msg, senderId: this.senderId, time: msg.time ?? Date.now() });
    }
    catch (e) {
      // e.g. a DataCloneError when the value contains functions
      this.logger.error(`Failed to broadcast '${msg.type}' for '${msg.name}':`, e);
    }
  }

  private receiveBroadcastedMessage(event: MessageEvent) {
    this.logger.debug(`---> State.receiveBroadcastedMessage()`, event);
    const msg: unknown = event.data;

    if (!State.isValidMessage(msg)) {
      this.logger.warn("Ignoring a malformed broadcast message:", msg);
      return;
    }
    if (msg.senderId === this.senderId) return;

    if (this.requestedState && BUFFERED_MESSAGE_TYPES.has(msg.type)) {
      this.bufferedMessages.push(msg);
      return;
    }

    this.handleMessage(msg);
  }

  private handleMessage(msg: BroadcastMessage) {
    try {
      switch (msg.type) {
        case "request-state": {
          // if the request is from an older page, ignore it
          if (msg.time < this.stateInitiatedAt) return;

          // then collect all state data and send them to the requester!
          this.broadcastMessage({
            type: "receive-state",
            targetId: msg.senderId,
            name: "state",
            data: this.collectState(),
            options: {}
          });
          break;
        }
        case "receive-state": {
          // only the first answer to our own request is used
          if (!this.requestedState || msg.targetId !== this.senderId) return;
          if (typeof msg.data !== "object" || msg.data === null) return;

          this.finishStateRequest(msg.data as StateSnapshot);
          break;
        }
        case "create-observable": {
          if (!State.isValidName(msg.name)) return;

          const existing: Observable | undefined = this.observables.get(msg.name);
          if (existing && !existing.isDefault()) {
            this.logger.warn(`Ignoring the creation of '${msg.name}' by another tab, as it already exists.`);
            return;
          }
          this.storeRemoteValue(msg.name, msg.data, msg.options.localStorage === true);
          break;
        }
        case "update-observable": {
          const name: string = State.getObservableFromPath(msg.name);
          const obs: Observable | undefined = this.observables.get(name);

          if (obs) {
            obs.set(msg.name, msg.data);
            if (msg.options.localStorage === true) this.keysInLocalStorage.add(name);
          }
          else if (msg.name === name && State.isValidName(name)) {
            // a full value for an observable that this tab missed
            this.storeRemoteValue(name, msg.data, msg.options.localStorage === true);
          }
          else {
            this.logger.warn(`Ignoring an update of '${msg.name}', as the observable does not exist.`);
          }
          break;
        }
        case "remove-observable": {
          // the tab that removed the observable has already cleaned the (shared) local storage
          this.deleteObservable(msg.name, false);
          break;
        }
      }
    }
    catch (e) {
      this.logger.error(`Failed to handle the '${msg.type}' message for '${msg.name}':`, e);
    }
  }

  /////////////////////
  //   OBSERVABLES   //
  /////////////////////

  /**
   * Create a new observable, or update one created with default value(s) by a subscriber.
   * An observable that is persisted in local storage is always broadcast to the other tabs, and a value already stored in local storage takes precedence over the given one.
   * @param {string} observable: the observable's name (it cannot contain dots)
   * @param {any} value: the observable's value
   * @param {Partial<ObservableOptions>} options: 'broadcastCreation' determines if the creation will be broadcast to other tabs, 'localStorage' determines if the observable will persist in local storage; default = { broadcastCreation: true, localStorage: false }
   */
  public createObservable(observable: string, value: any, options: Partial<ObservableOptions> = {}) {
    this.logger.debug(`---> State.createObservable(${observable})`, value, options);
    const opts: ObservableOptions = { ...DEFAULT_OPTIONS, ...options };

    this.createObservableInternal(observable, value, {
      persist: opts.localStorage,
      broadcast: opts.broadcastCreation,
      defaulted: false
    });
  }

  private createObservableInternal(observable: string, value: any, options: CreateInternalOptions) {
    if (!State.isValidName(observable)) {
      this.logger.warn(`Observable creation failed, '${observable}' is not a valid name (it must be non-empty and without dots).`);
      return;
    }

    const existing: Observable | undefined = this.observables.get(observable);
    if (existing && !existing.isDefault()) {
      this.logger.warn("Observable creation failed as it already exists.");
      return;
    }

    if (options.persist) {
      const stored: unknown = this.retrieveFromLocalStorage(observable);
      if (stored !== undefined) {
        // if the observable has been stored in local-storage, use its existing value instead
        value = stored;
      }
      else {
        this.storeInLocalStorage(observable, value);
      }
      if (!this.keysInLocalStorage.has(observable)) {
        this.keysInLocalStorage.add(observable);
        this.saveLocalStorageKeys();
      }
    }

    if (existing) {
      existing.set(observable, value);
      existing.invalidateDefaultStatus();
    }
    else {
      this.observables.set(observable, new Observable(observable, value, options.defaulted));
    }
    this.resolveWaiters(observable);

    // persisted observables are always broadcast, so that other tabs know about the key
    if (options.broadcast || options.persist) {
      this.broadcastMessage({
        type: "create-observable",
        name: observable,
        data: this.observables.get(observable)!.get(observable),
        options: { localStorage: options.persist }
      });
    }
  }

  /** Create or replace the observable with a value that was received from another tab; nothing is persisted or broadcast. */
  private storeRemoteValue(name: string, value: any, persisted: boolean) {
    const existing: Observable | undefined = this.observables.get(name);
    if (existing) {
      existing.set(name, value);
      existing.invalidateDefaultStatus();
    }
    else {
      this.observables.set(name, new Observable(name, value, false));
    }

    // the other tab has already written the (shared) local storage, this tab only needs to know the key is persisted
    if (persisted) this.keysInLocalStorage.add(name);
    this.resolveWaiters(name);
  }

  /**
   * Get an observable or a specific property value from it.
   * @param {string} path: the name of the observable object, including a possible required path; e.g: "user", "user.username", "game-system.checks.difficulty", etc
   * @param {number} timeoutMs: how long to wait for the observable to be created, if it does not exist yet; default = 0 (don't wait), Infinity = wait forever (use whenAvailable() if the wait needs to be cancellable)
   * @returns the value, or null if the observable or the property do not exist
   */
  public async getValueFromObservable<T>(path: string, timeoutMs: number = 0): Promise<T | null> {
    this.logger.debug(`---> State.getValueFromObservable(${path})`);
    const name: string = State.getObservableFromPath(path);

    let obs: Observable | undefined = this.observables.get(name) ?? this.createFromLocalStorage(name);

    if (!obs) {
      // the observable may still be on its way from another tab
      await this.stateReady;
      obs = this.observables.get(name);
    }
    if (!obs && timeoutMs > 0) {
      obs = await this.waitForObservable(name, timeoutMs);
    }
    if (!obs) return null;

    return this.readValue<T>(obs, path);
  }

  /**
   * Call a function with the value at the path, as soon as its observable exists: immediately if it already does, otherwise once (and if) it gets created.
   * An observable that only exists with a default value (created by a subscriber) does not count: the wait continues until the real value is created.
   * Unlike getValueFromObservable() with an infinite timeout, the wait can be cancelled, e.g. when a component is removed.
   * @param {string} path: the name of the observable object, including a possible required path; e.g: "user", "user.username"
   * @param {(value: T | null) => void} callback: called at most once; the value is null if the property does not exist
   * @returns a function that cancels the wait; it is safe to call it after the callback has run
   */
  public whenAvailable<T>(path: string, callback: (value: T | null) => void): () => void {
    this.logger.debug(`---> State.whenAvailable(${path})`);
    const name: string = State.getObservableFromPath(path);
    let settled: boolean = false;
    let remove: () => void = () => { };

    const deliver = () => {
      const obs: Observable | undefined = this.observables.get(name);
      if (settled || !obs) return;

      if (obs.isDefault()) {
        // only a placeholder created by a subscriber: keep waiting for the real value
        // (the waiters are cleared whenever they are notified, so register again)
        remove = this.addWaiter(name, deliver);
        return;
      }

      settled = true;
      try {
        callback(this.readValue<T>(obs, path));
      }
      catch (e) {
        this.logger.error(`whenAvailable callback for '${path}' failed:`, e);
      }
    };

    const existing: Observable | undefined = this.observables.get(name) ?? this.createFromLocalStorage(name);
    if (existing && !existing.isDefault()) {
      deliver();
      return () => { };
    }

    remove = this.addWaiter(name, deliver);
    return () => {
      settled = true;
      remove();
    };
  }

  /**
   * Subscribe to an observable and be notified of value changes. Create the observable with its default value if it does not exist yet.
   * If the observable is persisted in local storage, the stored value is used instead of the default one.
   * @param {string} observable: the name of the observable
   * @param {string} subscriber: the name of the subscriber
   * @param {Record<string, Listener>} listeners: dictionary of watched paths & listener functions to be called when the observable is updated - don't forget to use .bind(this)
   * @param {any} defaultValue: the observable's default value, in case it has not been created yet
   */
  public subscribeToObservable(observable: string, subscriber: string, listeners: Record<string, Listener>, defaultValue: any) {
    this.logger.debug(`---> State.subscribeToObservable(${observable}, ${subscriber})`, defaultValue);

    let obs: Observable | undefined = this.observables.get(observable) ?? this.createFromLocalStorage(observable);
    if (!obs) {
      this.createObservableInternal(observable, defaultValue, { persist: false, broadcast: false, defaulted: true });
      obs = this.observables.get(observable);
    }

    obs?.subscribe(subscriber, listeners);
  }

  /**
   * Unsubscribe a subscriber from an observable.
   * @param {string} observable: the observable's name
   * @param {string} subscriber: the subscriber's name
   * @param {string[]} listeners: the watched paths to unsubscribe; default = all of the subscriber's listeners
   */
  public unsubscribeFromObservable(observable: string, subscriber: string, listeners?: string[]) {
    this.logger.debug(`---> State.unsubscribeFromObservable(${observable}, ${subscriber})`);
    this.observables.get(observable)?.unsubscribe(subscriber, listeners);
  }

  /**
   * Update an observable or some specific property within it. Updating an observable that does not exist is skipped.
   * @param {string} path: the name of the observable object, including a possible required path; e.g: "user", "user.username", "game-system.checks.difficulty", etc
   * @param {any} value: the updated value
   * @param {boolean} broadcastChange: if this is to be broadcast within the browser (using the broadcast channel API); default=true
   */
  public updateObservable(path: string, value: any, broadcastChange: boolean = true) {
    this.logger.debug(`---> State.updateObservable(${path})`, value);
    const name: string = State.getObservableFromPath(path);

    const obs: Observable | undefined = this.observables.get(name);
    if (!obs) {
      this.logger.warn(`Update of '${path}' skipped, as the observable does not exist.`);
      return;
    }

    try {
      obs.set(path, value);
    }
    catch (e) {
      this.logger.warn(`Update of '${path}' failed:`, e);
      return;
    }

    const persisted: boolean = this.keysInLocalStorage.has(name);
    if (persisted) this.storeInLocalStorage(name, obs.get(name));

    if (broadcastChange) this.broadcastMessage({
      type: "update-observable",
      name: path,
      data: value,
      options: { localStorage: persisted }
    });
  }

  /**
   * Remove an observable, together with its value in local storage (if persisted). Its subscribers are dropped.
   * @param {string} observable: the observable's name
   * @param {boolean} broadcastRemoval: if this is to be broadcast to the other tabs; default=true
   */
  public removeObservable(observable: string, broadcastRemoval: boolean = true) {
    this.logger.debug(`---> State.removeObservable(${observable})`);
    this.deleteObservable(observable, true);

    if (broadcastRemoval) this.broadcastMessage({
      type: "remove-observable",
      name: observable,
      data: null,
      options: {}
    });
  }

  private deleteObservable(observable: string, touchLocalStorage: boolean) {
    this.observables.delete(observable);

    if (this.keysInLocalStorage.delete(observable) && touchLocalStorage) {
      this.removeFromLocalStorage(observable);
      this.saveLocalStorageKeys();
    }
  }

  /** Register a function to be called when the observable gets created; returns a function that removes it. */
  private addWaiter(name: string, waiter: () => void): () => void {
    let waiting: Set<() => void> | undefined = this.waiters.get(name);
    if (!waiting) {
      waiting = new Set();
      this.waiters.set(name, waiting);
    }
    waiting.add(waiter);

    return () => {
      const current: Set<() => void> | undefined = this.waiters.get(name);
      if (!current) return;
      current.delete(waiter);
      if (current.size === 0) this.waiters.delete(name);
    };
  }

  /** Wait until the observable gets created, or the timeout passes. */
  private waitForObservable(name: string, timeoutMs: number): Promise<Observable | undefined> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let remove: () => void = () => { };

      const done = () => {
        clearTimeout(timer);
        remove();
        resolve(this.observables.get(name));
      };

      remove = this.addWaiter(name, done);
      if (Number.isFinite(timeoutMs)) timer = setTimeout(done, timeoutMs);
    });
  }

  /** Read a value from an observable; null if the property does not exist or the path is invalid. */
  private readValue<T>(obs: Observable, path: string): T | null {
    try {
      const value: unknown = obs.get(path);
      return value === undefined ? null : value as T;
    }
    catch (e) {
      this.logger.warn(`Could not read '${path}':`, e);
      return null;
    }
  }

  private resolveWaiters(name: string) {
    const waiting: Set<() => void> | undefined = this.waiters.get(name);
    if (!waiting) return;

    this.waiters.delete(name);
    waiting.forEach((done) => done());
  }

  ///////////////////////
  //   LOCAL STORAGE   //
  ///////////////////////

  /** If the observable is persisted and has a stored value, create it from that value. */
  private createFromLocalStorage(name: string): Observable | undefined {
    if (!this.keysInLocalStorage.has(name)) return undefined;
    if (this.retrieveFromLocalStorage(name) === undefined) return undefined;

    this.createObservableInternal(name, null, { persist: true, broadcast: false, defaulted: false });
    return this.observables.get(name);
  }

  /** @returns the stored value, or undefined if nothing is stored or it cannot be read */
  private retrieveFromLocalStorage(key: string): unknown {
    try {
      const s: string | null = window.localStorage.getItem(key);
      return s !== null ? JSON.parse(s) : undefined;
    }
    catch (e) {
      this.logger.error(`Failed to read '${key}' from local storage:`, e);
      return undefined;
    }
  }

  private storeInLocalStorage(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value ?? null));
    }
    catch (e) {
      this.logger.error(`Failed to store '${key}' in local storage:`, e);
    }
  }

  private removeFromLocalStorage(key: string) {
    try {
      window.localStorage.removeItem(key);
    }
    catch (e) {
      this.logger.error(`Failed to remove '${key}' from local storage:`, e);
    }
  }

  private loadLocalStorageKeys() {
    try {
      const s: string | null = window.localStorage.getItem(LOCAL_STORAGE_STATE_KEY);
      if (!s) return;

      const keys: unknown = JSON.parse(s);
      if (!Array.isArray(keys)) return;
      keys.forEach((k: unknown) => {
        if (typeof k === "string") this.keysInLocalStorage.add(k);
      });
    }
    catch (e) {
      this.logger.error("Failed to load the local storage keys:", e);
    }
  }

  private saveLocalStorageKeys() {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify([...this.keysInLocalStorage]));
    }
    catch (e) {
      this.logger.error("Failed to save the local storage keys:", e);
    }
  }

  /////////////////
  //   HELPERS   //
  /////////////////

  private static getObservableFromPath(path: string): string {
    const dot: number = path.indexOf(".");
    return dot < 0 ? path : path.substring(0, dot);
  }

  private static isValidName(name: unknown): name is string {
    return typeof name === "string" && name.length > 0 && !name.includes(".");
  }

  private static isValidMessage(msg: unknown): msg is BroadcastMessage {
    if (typeof msg !== "object" || msg === null) return false;

    const m = msg as Record<string, unknown>;
    return typeof m.type === "string" && MESSAGE_TYPES.has(m.type)
      && typeof m.senderId === "string"
      && typeof m.name === "string"
      && typeof m.time === "number"
      && typeof m.options === "object" && m.options !== null;
  }
}
