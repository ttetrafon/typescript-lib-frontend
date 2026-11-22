import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./timings";

describe("debounce", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls once, with the last arguments, after the wait", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d("a");
    vi.advanceTimersByTime(50);
    d("b");
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });

  it("can run again after it has fired", () => {
    const fn = vi.fn();
    const d = debounce(fn, 10);

    d(1);
    vi.advanceTimersByTime(10);
    d(2);
    vi.advanceTimersByTime(10);
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it("cancel() drops the pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 10);

    d();
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush() runs the pending call at once, and only once", () => {
    const fn = vi.fn();
    const d = debounce(fn, 10);

    d("x");
    d.flush();
    expect(fn).toHaveBeenCalledWith("x");

    d.flush();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps `this` of the last call", () => {
    const seen: unknown[] = [];
    const obj = { v: 7, run: debounce(function (this: { v: number }) { seen.push(this.v); }, 5) };

    obj.run();
    vi.advanceTimersByTime(5);
    expect(seen).toEqual([7]);
  });
});
