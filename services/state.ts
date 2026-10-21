import { cloneDeep } from "lodash";
import { Logger } from "../../lib/services/logger";
import { BroadcastMessage, Listener, ObservableOptions } from "library/lib-fe/types";
import { Observable } from "library/lib-fe/wrappers/Observable";
import { LOCAL_STORAGE_STATE_KEY } from "library/lib-fe/data/constants";

export class State {
  static #instance: State;
  #logger: Logger;

  private appName: string;
  private stateInitiatedAt: number;
  private requestedState: boolean = false;

  private observables: Record<string, Observable> = {};
  private observablesBroadcastChannel: BroadcastChannel;

  private keysInLocalStorage: Set<string> = new Set();

  private constructor(appName: string) {
    this.#logger = Logger.getInstance();

    this.appName = appName;
    this.stateInitiatedAt = new Date().valueOf();
    this.loadLocalStorageKeys();

    this.observablesBroadcastChannel = new BroadcastChannel(this.appName);
    this.observablesBroadcastChannel.onmessage = (event) => {
      this.receiveBroadcastedMessage(event);
    }

    this.requestedState = true;
    this.broadcastMessage({
      type: "request-state",
      time: this.stateInitiatedAt,
      name: "state",
      data: null,
      options: {}
    });
  }

  public static getInstance(appName: string): State {
    return this.#instance ??= new State(appName);
  }

  ///////////////
  //   STATE   //
  ///////////////

  private collectState(): Record<string, any> {
    this.#logger.debug(`---> State.collectState()`);
    let state: Record<string, any> = {};
    let keys = Object.keys(this.observables);
    for (let i = 0; i < keys.length; i++) {
      state[keys[i]] = cloneDeep(this.observables[keys[i]].get(keys[i]));
    }
    return state;
  }

  ////////////////////
  //   BROADCASTS   //
  ////////////////////

  private async broadcastMessage(msg: BroadcastMessage) {
    this.#logger.debug(`---> State.broadcastMessage()`, msg);
    this.observablesBroadcastChannel.postMessage(msg);
  }

  private async receiveBroadcastedMessage(event: MessageEvent) {
    this.#logger.debug(`---> receiveBroadcastedMessage()`, event);
    let msg = event.data as BroadcastMessage;

    console.log("msg:", msg);
    switch (msg.type) {
      case "request-state": {
        // if the request is from an older page, ignore it
        if (msg.time < this.stateInitiatedAt) return;

        // then collect all state data and send them!
        this.broadcastMessage({
          type: "receive-state",
          name: "state",
          data: this.collectState(),
          time: new Date().getTime(),
          options: {}
        });
        break;
      }
      case "receive-state": {
        if (!this.requestedState) return;

        this.requestedState = false;
        let keys: string[] = Object.keys(msg.data);

        for (let i = 0; i < keys.length; i++) {
          let key: string = keys[i];

          if (Object.prototype.hasOwnProperty.call(this.observables, key)) {
            this.updateObservable(key, msg.data[key], false);
          }
          else {
            this.createObservable(key, msg.data[key], {
              broadcastCreation: false,
              localStorage: msg.options.localStorage ?? false
            });
          }
        }
        break;
      }
      case "create-observable": {
        this.createObservable(msg.name, msg.data, {
          broadcastCreation: false,
          localStorage: msg.options.localStorage ?? false
        });
        break;
      }
      case "update-observable": {
        this.updateObservable(msg.name, msg.data, false);
        break;
      }
    }
  }

  /////////////////////
  //   OBSERVABLES   //
  /////////////////////

  /**
   * Create a new observable
   * @param {string} observable: the observable's name
   * @param {any} value: the observable's value
   * @param {ObservableOptions} options: observable secondary options: 'broadcastCreation' determines if the creation will be broadcast to other tabs, 'localStorage' determines if the observable will persist in local storage; default = { broadcastCreation: true, localStorage: false }
   */
  createObservable(observable: string, value: any, options: ObservableOptions = { broadcastCreation: true, localStorage: false }) {
    this.#logger.debug(`---> State.createObservable()`, observable, value, options);

    if (this.observables.hasOwnProperty(observable)) {
      this.#logger.warn("Observable creation failed as it already exists.");
      return;
    }

    if (options.localStorage) {
      const existingValue: any = this.retrieveFromLocalStorage(observable);
      if (existingValue) {
        // if the observable has been stored in local-storage, use its existing value instead
        value = existingValue;
      }
      else {
        this.addObservableInLocalStorage(observable, value);
      }
    }

    this.observables[observable] = new Observable(observable, value);

    if (options.broadcastCreation) this.broadcastMessage({
      type: 'create-observable',
      name: observable,
      data: value,
      time: new Date().getTime(),
      options: {
        broadcastCreation: false,
        localStorage: false
      }
    });

    this.#logger.debug("... observables:", this.observables);
  }

  /**
   * Get an observable or a specific property value from it.
   * @param {string} path: the name of the observable object, including a possible required path; e.g: "user", "user.username", "game-system.checks.difficulty", etc
   * @param {number} retry: for internal, recursive usage, in case the initial state is not yet here; default = 0
   * @returns
   */
  async getValueFromObservable<T>(path: string, retry: number = 0): Promise<T | null> {
    this.#logger.debug(`---> State.getValueFromObservable(${path})`);
    const observable: string = this.getObservableFromPath(path);

    const obs: Observable = this.observables[observable];
    console.log("observable:", observable, obs);
    if (obs) {
      return obs.get(path);
    }

    const localStorageValue: T = this.retrieveFromLocalStorage(observable) as T;
    if (localStorageValue !== null) {
      this.createObservable(observable, localStorageValue, { localStorage: false, broadcastCreation: true });
      return localStorageValue;
    }

    if (retry < 10) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      return this.getValueFromObservable(path, retry + 1);
    }

    return null;
  }

  /**
   * Subscribe to an observable and be notified of value changes.
   * @param {string} observable: the name of the observable
   * @param {string} subscriber: the name of the
   * @param {Record<string, Listener>} listeners: dictionary of identifiers & listener functions to be called when the observable is updated - don't forget to use .bind(this)
   * @param {number} retry: for internal, recursive usage, in case the initial state is not yet here
   */
  async subscribeToObservable(observable: string, subscriber: string, listeners: Record<string, Listener>, retry: number = 0) {
    this.#logger.debug(`---> subscribeToObservable(${observable}, ${subscriber})`);
    const obs: Observable = this.observables[observable];
    if (obs) {
      obs.subscribe(subscriber, listeners);
      return;
    }

    if (retry < 10) {
      setTimeout(async () => {
        return await this.subscribeToObservable(observable, subscriber, listeners, retry + 1);
      }, 1000);
    }
    this.#logger.debug(`... this.observables[${observable}]:`, this.observables[observable]);
  }

  /**
   * Unsubscribe a specific listener from an observable.
   * @param {string} observable: the observable's name
   * @param {string} subscriber: the subscriber's name
   */
  async unsubscribeFromObservable(observable: string, subscriber: string, listeners?: string[]) {
    this.#logger.debug(`---> unsubscribeFromObservable(${observable}, ${subscriber})`);
    const obs: Observable = this.observables[observable];
    if (obs) {
      obs.unsubscribe(subscriber, listeners);
    }
  }

  /**
   * Update an observable or some specific property within it.
   * @param {string} path: the name of the observable object, including a possible required path; e.g: "user", "user.username", "game-system.checks.difficulty", etc
   * @param {any} value: the updated value
   * @param {boolean} broadcastChange: if this is to be broadcast within the browser (using the broadcast channel API); default=true
   */
  async updateObservable(path: string, value: any, broadcastChange: boolean = true) {
    this.#logger.debug(`---> State.updateObservable(${path}`, value);
    const observable: string = this.getObservableFromPath(path);

    const obs: Observable = this.observables[observable];
    if (obs) {
      obs.set(path, value);
    }
    this.#logger.debug(`... this.observables[${observable}] updated:`, this.observables[observable]);

    if (this.isObservableInLocalStorage(observable)) {
      this.storeInLocalStorage(observable, obs.get());
    }

    if (broadcastChange) this.broadcastMessage({
      type: "update-observable",
      name: path,
      data: value,
      time: new Date().getTime(),
      options: { localStorage: this.isObservableInLocalStorage(path) }
    });
  }

  ///////////////////////
  //   LOCAL STORAGE   //
  ///////////////////////

  public addObservableInLocalStorage(observable: string, value: any) {
    setTimeout(() => {
      this.storeInLocalStorage(observable, value);
      this.keysInLocalStorage.add(observable);
      this.saveLocalStorageKeys();
    }, 0);
  }

  public isObservableInLocalStorage(path: string): boolean {
    const observable = this.getObservableFromPath(path);
    return this.keysInLocalStorage.has(observable);
  }

  public retrieveFromLocalStorage(key: string): any {
    const s: string | null = window.localStorage.getItem(key);
    return s !== null ? JSON.parse(s) : null;
  }

  public storeInLocalStorage(key: string, value: any) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  public loadLocalStorageKeys() {
    const s: string | null = window.localStorage.getItem(LOCAL_STORAGE_STATE_KEY);
    if (s) {
      const keys: string[] = JSON.parse(s);
      keys.forEach((k: string) => this.keysInLocalStorage.add(k));
    }
  }

  public saveLocalStorageKeys() {
    window.localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify([...this.keysInLocalStorage]));
  }

  /////////////////
  //   HELPERS   //
  /////////////////

  private getObservableFromPath(path: string): string {
    const dot: number = path.indexOf(".");
    return dot < 0 ? path : path.substring(0, dot);
  }
}
