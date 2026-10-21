import { OBSERVABLE_WINDOW_SIZE } from "../data/constants";
import { State } from "../services/state";
import { WindowSize } from "../types";

export class WindowSizeWatcher {
  static #instance: WindowSizeWatcher;
  #state: State;

  public static getInstance(stateService: State): WindowSizeWatcher {
    return this.#instance ??= new WindowSizeWatcher(stateService);
  }

  private constructor(stateService: State) {
    this.#state = stateService;

    this.#state.createObservable(
      OBSERVABLE_WINDOW_SIZE,
      {
        width: 0, height: 0
      },
      {
        localStorage: false,
        broadcastCreation: false
      }
    );

    window.addEventListener("resize", () => {
      const ws: WindowSize = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      this.#state.updateObservable(OBSERVABLE_WINDOW_SIZE, ws, false);
    });
  }
}
