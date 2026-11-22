export type Debounced<T extends unknown[]> = {
  (...args: T): void;
  /** Drop the pending call, if any. */
  cancel(): void;
  /** Run the pending call right now, if any. */
  flush(): void;
};

/**
 * Delay calling a function until the calls have stopped for `wait` milliseconds (trailing edge).
 * The function is called with the arguments and `this` of the last call.
 * Remember to cancel() a pending call when its owner goes away, e.g. in disconnectedCallback.
 * @param {Function} fn: the function to execute
 * @param {number} wait: the quiet time in milliseconds before fn is executed
 * @returns the debounced function, with cancel() and flush()
 */
export function debounce<T extends unknown[]>(fn: (this: any, ...args: T) => void, wait: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { self: any; args: T } | null = null;

  const run = () => {
    timer = undefined;
    if (!pending) return;
    const { self, args } = pending;
    pending = null;
    fn.apply(self, args);
  };

  const debounced = function (this: any, ...args: T) {
    pending = { self: this, args };
    clearTimeout(timer);
    timer = setTimeout(run, wait);
  } as Debounced<T>;

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
  };

  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };

  return debounced;
}
