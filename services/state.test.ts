import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { State } from './state';
import { LOCAL_STORAGE_STATE_KEY } from 'library/lib-fe/data/constants';

// State is a singleton, so every test gets a fresh module (and a unique channel name).
// Other browser tabs are simulated with plain BroadcastChannels on the same channel.

let counter = 0;
let appName: string;
let channels: BroadcastChannel[] = [];
let states: State[] = [];

/**
 * @param skipStartup: finish the initial state request right away (nobody answers it in most tests), instead of waiting for it
 */
async function createState(skipStartup: boolean = true): Promise<State> {
  vi.resetModules();
  const { State } = await import('./state');
  const state = State.getInstance(appName);
  states.push(state);
  if (skipStartup) (state as any).finishStateRequest();
  return state;
}

/** A simulated other tab: records what it receives, and sends messages as 'other-tab'. */
function openTab() {
  const channel = new BroadcastChannel(appName);
  const received: any[] = [];
  channel.onmessage = (e: MessageEvent) => received.push(e.data);
  channels.push(channel);

  return {
    received,
    ofType: (type: string) => received.filter((m) => m.type === type),
    send: (msg: object) => channel.postMessage({ senderId: "other-tab", time: Date.now(), name: "x", data: null, options: {}, ...msg }),
    raw: (data: unknown) => channel.postMessage(data),
  };
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number = 1000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Give messages time to arrive, for asserting that something did NOT happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const storedKeys = (): string[] => JSON.parse(localStorage.getItem(LOCAL_STORAGE_STATE_KEY) ?? "[]");

beforeEach(() => {
  appName = `test-app-${++counter}`;
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => { });
});

afterEach(() => {
  states.forEach((s) => {
    clearTimeout((s as any).requestTimer);
    (s as any).channel.close();
  });
  channels.forEach((c) => c.close());
  states = [];
  channels = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('State', () => {
  describe('getInstance', () => {
    it('returns the same instance on every call', async () => {
      vi.resetModules();
      const { State } = await import('./state');
      const a = State.getInstance(appName);
      states.push(a);
      expect(State.getInstance(appName)).toBe(a);
    });

    it('warns, and keeps the existing instance, when called with another app name', async () => {
      vi.resetModules();
      const { Logger } = await import('library/lib/services/logger');
      const { State } = await import('./state');
      Logger.getInstance().setLevel("warn");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => { });

      const a = State.getInstance(appName);
      states.push(a);
      expect(State.getInstance("another-app")).toBe(a);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('createObservable & getValueFromObservable', () => {
    it('creates an observable and returns its value, or a part of it', async () => {
      const s = await createState();
      s.createObservable("user", { name: "Ann", address: { city: "Rome" } });

      expect(await s.getValueFromObservable("user")).toEqual({ name: "Ann", address: { city: "Rome" } });
      expect(await s.getValueFromObservable("user.name")).toBe("Ann");
      expect(await s.getValueFromObservable("user.address.city")).toBe("Rome");
    });

    it('returns null for missing observables and properties, and for invalid paths', async () => {
      const s = await createState();
      s.createObservable("user", { name: "Ann" });

      expect(await s.getValueFromObservable("nothing")).toBeNull();
      expect(await s.getValueFromObservable("user.age")).toBeNull();
      expect(await s.getValueFromObservable("user.name.first")).toBeNull();
    });

    it('ignores invalid observable names', async () => {
      const s = await createState();
      s.createObservable("", 1);
      s.createObservable("a.b", 1);

      expect(await s.getValueFromObservable("")).toBeNull();
      expect(await s.getValueFromObservable("a")).toBeNull();
    });

    it('does not replace an existing observable', async () => {
      const s = await createState();
      s.createObservable("o", 1);
      s.createObservable("o", 2);
      expect(await s.getValueFromObservable("o")).toBe(1);
    });

    it('keeps its state isolated from the objects going in and out', async () => {
      const s = await createState();
      const original = { list: [1] };
      s.createObservable("o", original);
      original.list.push(2);

      const read: any = await s.getValueFromObservable("o");
      expect(read).toEqual({ list: [1] });
      read.list.push(3);
      expect(await s.getValueFromObservable("o")).toEqual({ list: [1] });
    });

    it('waits for an observable to be created, when given a timeout', async () => {
      const s = await createState();
      const pending = s.getValueFromObservable("late", Infinity);
      s.createObservable("late", 5);
      expect(await pending).toBe(5);
    });

    it('gives up after the timeout, and cleans up after itself', async () => {
      const s = await createState();
      expect(await s.getValueFromObservable("never", 20)).toBeNull();
      expect((s as any).waiters.size).toBe(0);
    });
  });

  describe('updateObservable', () => {
    it('updates the whole value or a part of it', async () => {
      const s = await createState();
      s.createObservable("user", { name: "Ann", address: { city: "Rome" } });

      s.updateObservable("user.address.city", "Milan");
      expect(await s.getValueFromObservable("user")).toEqual({ name: "Ann", address: { city: "Milan" } });

      s.updateObservable("user", { name: "Bob" });
      expect(await s.getValueFromObservable("user")).toEqual({ name: "Bob" });
    });

    it('skips unknown observables, without broadcasting', async () => {
      const tab = openTab();
      const s = await createState();

      expect(() => s.updateObservable("ghost.x", 1)).not.toThrow();
      expect(await s.getValueFromObservable("ghost")).toBeNull();
      await settle();
      expect(tab.ofType("update-observable")).toHaveLength(0);
    });

    it('skips invalid paths, without broadcasting', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("user", { name: "Ann" });

      s.updateObservable("user.name.first", "A");
      expect(await s.getValueFromObservable("user")).toEqual({ name: "Ann" });
      await settle();
      expect(tab.ofType("update-observable")).toHaveLength(0);
    });
  });

  describe('subscriptions', () => {
    it('notifies a subscriber about changes of the paths it watches', async () => {
      const s = await createState();
      const listener = vi.fn();
      s.subscribeToObservable("user", "cmp", { "user.name": listener }, { name: "a", names: "x", age: 1 });

      s.updateObservable("user.name", "b");
      expect(listener).toHaveBeenCalledExactlyOnceWith("cmp", "user.name", "b");
    });

    it('does not notify about unrelated paths, even if they share a prefix', async () => {
      const s = await createState();
      const listener = vi.fn();
      s.subscribeToObservable("user", "cmp", { "user.name": listener }, { name: "a", names: "x", age: 1 });

      s.updateObservable("user.age", 2);
      s.updateObservable("user.names", "y");
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies when an ancestor of the watched path is updated', async () => {
      const s = await createState();
      const listener = vi.fn();
      s.subscribeToObservable("user", "cmp", { "user.address.city": listener }, { address: { city: "Rome" } });

      s.updateObservable("user", { address: { city: "Milan" } });
      expect(listener).toHaveBeenCalledExactlyOnceWith("cmp", "user.address.city", "Milan");
    });

    it('stops notifying after unsubscribing, fully or for specific paths', async () => {
      const s = await createState();
      const a = vi.fn();
      const b = vi.fn();
      s.subscribeToObservable("o", "cmp", { "o.a": a, "o.b": b }, { a: 1, b: 1 });

      s.unsubscribeFromObservable("o", "cmp", ["o.a"]);
      s.updateObservable("o.a", 2);
      s.updateObservable("o.b", 2);
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);

      s.unsubscribeFromObservable("o", "cmp");
      s.updateObservable("o.b", 3);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('keeps notifying the other listeners when one of them throws', async () => {
      const s = await createState();
      const good = vi.fn();
      s.subscribeToObservable("o", "bad", { "o.a": () => { throw new Error("boom"); } }, { a: 1 });
      s.subscribeToObservable("o", "good", { "o.a": good }, { a: 1 });

      s.updateObservable("o.a", 2);
      expect(good).toHaveBeenCalledTimes(1);
    });

    it('creates the observable with the default value, without broadcasting it', async () => {
      const tab = openTab();
      const s = await createState();
      s.subscribeToObservable("o", "cmp", {}, { a: 1 });

      expect(await s.getValueFromObservable("o")).toEqual({ a: 1 });
      await settle();
      expect(tab.ofType("create-observable")).toHaveLength(0);
    });

    it('notifies subscribers when the real value replaces the default one', async () => {
      const s = await createState();
      const listener = vi.fn();
      s.subscribeToObservable("o", "cmp", { "o": listener }, { a: 1 });

      s.createObservable("o", { a: 2 });
      expect(listener).toHaveBeenCalledExactlyOnceWith("cmp", "o", { a: 2 });
      expect(await s.getValueFromObservable("o")).toEqual({ a: 2 });
    });
  });

  describe('whenAvailable', () => {
    it('calls back immediately when the observable exists', async () => {
      const s = await createState();
      s.createObservable("o", { a: 1 });
      const callback = vi.fn();

      s.whenAvailable("o.a", callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('calls back once, when the observable gets created', async () => {
      const s = await createState();
      const callback = vi.fn();
      s.whenAvailable("late.value", callback);
      expect(callback).not.toHaveBeenCalled();

      s.createObservable("late", { value: 7 });
      s.updateObservable("late.value", 8);
      expect(callback).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('calls back with null when the property does not exist', async () => {
      const s = await createState();
      s.createObservable("o", { a: 1 });
      const callback = vi.fn();

      s.whenAvailable("o.zzz", callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('ignores a default value and waits for the real one', async () => {
      const s = await createState();
      const callback = vi.fn();
      s.subscribeToObservable("o", "cmp", {}, { a: "default" });

      s.whenAvailable("o.a", callback);
      expect(callback).not.toHaveBeenCalled();

      s.createObservable("o", { a: "real" });
      expect(callback).toHaveBeenCalledExactlyOnceWith("real");
    });

    it('keeps waiting when a placeholder is created while it waits', async () => {
      const s = await createState();
      const callback = vi.fn();
      s.whenAvailable("o.a", callback);

      s.subscribeToObservable("o", "cmp", {}, { a: "default" });
      expect(callback).not.toHaveBeenCalled();

      s.createObservable("o", { a: "real" });
      expect(callback).toHaveBeenCalledExactlyOnceWith("real");
    });

    it('can be cancelled, also while only a placeholder exists, and after it has fired', async () => {
      const s = await createState();
      const waiting = vi.fn();
      const placeholder = vi.fn();
      const fired = vi.fn();

      const cancelWaiting = s.whenAvailable("a", waiting);
      s.subscribeToObservable("b", "cmp", {}, 1);
      const cancelPlaceholder = s.whenAvailable("b", placeholder);
      s.createObservable("c", 1);
      const cancelFired = s.whenAvailable("c", fired);

      cancelWaiting();
      cancelPlaceholder();
      expect(() => cancelFired()).not.toThrow();

      s.createObservable("a", 1);
      s.createObservable("b", 1);
      expect(waiting).not.toHaveBeenCalled();
      expect(placeholder).not.toHaveBeenCalled();
      expect((s as any).waiters.size).toBe(0);
    });

    it('survives a throwing callback', async () => {
      const s = await createState();
      const other = vi.fn();
      s.whenAvailable("o", () => { throw new Error("boom"); });
      s.whenAvailable("o", other);

      s.createObservable("o", 1);
      expect(other).toHaveBeenCalledExactlyOnceWith(1);
    });
  });

  describe('removeObservable', () => {
    it('removes the observable and drops its subscribers', async () => {
      const s = await createState();
      const listener = vi.fn();
      s.subscribeToObservable("o", "cmp", { "o": listener }, 1);

      s.removeObservable("o");
      expect(await s.getValueFromObservable("o")).toBeNull();

      s.createObservable("o", 2);
      expect(listener).not.toHaveBeenCalled();
    });

    it('also removes the value and the key from local storage', async () => {
      const s = await createState();
      s.createObservable("p", 1, { localStorage: true });
      s.createObservable("q", 1, { localStorage: true });

      s.removeObservable("p");
      expect(localStorage.getItem("p")).toBeNull();
      expect(storedKeys()).toEqual(["q"]);
      expect(localStorage.getItem("q")).not.toBeNull();
    });

    it('can remove observables that do not exist', async () => {
      const s = await createState();
      expect(() => s.removeObservable("ghost")).not.toThrow();
    });
  });

  describe('local storage', () => {
    it('stores persisted observables and remembers their keys', async () => {
      const s = await createState();
      s.createObservable("p", { a: 1 }, { localStorage: true });
      s.createObservable("np", { a: 1 });

      expect(JSON.parse(localStorage.getItem("p")!)).toEqual({ a: 1 });
      expect(storedKeys()).toEqual(["p"]);
      expect(localStorage.getItem("np")).toBeNull();
    });

    it('prefers an already stored value over the given one, including falsy values', async () => {
      const s = await createState();
      localStorage.setItem("obj", JSON.stringify({ a: 99 }));
      localStorage.setItem("zero", "0");
      localStorage.setItem("no", "false");
      localStorage.setItem("empty", '""');

      s.createObservable("obj", { a: 1 }, { localStorage: true });
      s.createObservable("zero", 5, { localStorage: true });
      s.createObservable("no", true, { localStorage: true });
      s.createObservable("empty", "text", { localStorage: true });

      expect(await s.getValueFromObservable("obj")).toEqual({ a: 99 });
      expect(await s.getValueFromObservable("zero")).toBe(0);
      expect(await s.getValueFromObservable("no")).toBe(false);
      expect(await s.getValueFromObservable("empty")).toBe("");
    });

    it('persists updates, including updates of nested properties', async () => {
      const s = await createState();
      s.createObservable("p", { a: { b: 1 } }, { localStorage: true });

      s.updateObservable("p.a.b", 2);
      expect(JSON.parse(localStorage.getItem("p")!)).toEqual({ a: { b: 2 } });
    });

    it('does not persist updates of observables that are not persisted', async () => {
      const s = await createState();
      s.createObservable("np", { a: 1 });
      s.updateObservable("np.a", 2);
      expect(localStorage.getItem("np")).toBeNull();
    });

    it('uses the stored value, not the default one, when subscribing', async () => {
      localStorage.setItem("p", JSON.stringify({ a: "stored" }));
      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify(["p"]));
      const s = await createState();

      s.subscribeToObservable("p", "cmp", {}, { a: "default" });
      expect(await s.getValueFromObservable("p")).toEqual({ a: "stored" });
    });

    it('loads a stored observable on request, without waiting', async () => {
      localStorage.setItem("p", JSON.stringify(42));
      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify(["p"]));
      const s = await createState();

      expect(await s.getValueFromObservable("p")).toBe(42);
    });

    it('does not adopt stored values that it did not persist itself', async () => {
      localStorage.setItem("foreign", JSON.stringify(1));
      const s = await createState();
      expect(await s.getValueFromObservable("foreign")).toBeNull();
    });

    it('survives corrupt data in local storage', async () => {
      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, "{not json");
      expect(await createState()).toBeDefined();

      appName += "-b";
      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify(["p"]));
      localStorage.setItem("p", "{not json");
      const s = await createState();
      expect(await s.getValueFromObservable("p")).toBeNull();
    });

    it('keeps working when local storage cannot be written', async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
      const s = await createState();

      expect(() => s.createObservable("p", 1, { localStorage: true })).not.toThrow();
      s.updateObservable("p", 2);
      expect(await s.getValueFromObservable("p")).toBe(2);
    });
  });

  describe('broadcasting', () => {
    it('broadcasts created observables', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("user", { a: 1 });

      await waitFor(() => tab.ofType("create-observable").length === 1);
      const msg = tab.ofType("create-observable")[0];
      expect(msg).toMatchObject({ name: "user", data: { a: 1 }, options: { localStorage: false } });
      expect(typeof msg.senderId).toBe("string");
      expect(msg.senderId).not.toBe("other-tab");
    });

    it('does not broadcast the creation when told not to', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("quiet", 1, { broadcastCreation: false });

      await settle();
      expect(tab.ofType("create-observable")).toHaveLength(0);
    });

    it('always broadcasts persisted observables, with the persisted flag', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("p", 1, { localStorage: true, broadcastCreation: false });

      await waitFor(() => tab.ofType("create-observable").length === 1);
      expect(tab.ofType("create-observable")[0]).toMatchObject({ name: "p", data: 1, options: { localStorage: true } });
    });

    it('broadcasts the stored value of a persisted observable, not the given one', async () => {
      localStorage.setItem("p", JSON.stringify("stored"));
      const tab = openTab();
      const s = await createState();
      s.createObservable("p", "given", { localStorage: true });

      await waitFor(() => tab.ofType("create-observable").length === 1);
      expect(tab.ofType("create-observable")[0].data).toBe("stored");
    });

    it('broadcasts updates with their path, unless told not to', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("user", { a: { b: 1 } }, { broadcastCreation: false });

      s.updateObservable("user.a.b", 2);
      s.updateObservable("user.a.b", 3, false);

      await waitFor(() => tab.ofType("update-observable").length === 1);
      await settle();
      expect(tab.ofType("update-observable")).toHaveLength(1);
      expect(tab.ofType("update-observable")[0]).toMatchObject({ name: "user.a.b", data: 2, options: { localStorage: false } });
    });

    it('flags updates of persisted observables', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("p", { a: 1 }, { localStorage: true });

      s.updateObservable("p.a", 2);
      await waitFor(() => tab.ofType("update-observable").length === 1);
      expect(tab.ofType("update-observable")[0].options.localStorage).toBe(true);
    });

    it('broadcasts removals, unless told not to', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("a", 1, { broadcastCreation: false });
      s.createObservable("b", 1, { broadcastCreation: false });

      s.removeObservable("a");
      s.removeObservable("b", false);

      await waitFor(() => tab.ofType("remove-observable").length === 1);
      await settle();
      expect(tab.ofType("remove-observable")).toHaveLength(1);
      expect(tab.ofType("remove-observable")[0].name).toBe("a");
    });

    it('survives values that cannot be cloned, leaving the state unchanged', async () => {
      const s = await createState();
      s.createObservable("o", { a: 1 });
      // functions cannot be cloned, so the update is rejected (and logged) before anything is changed or broadcast
      expect(() => s.updateObservable("o.a", () => { })).not.toThrow();
      expect(await s.getValueFromObservable("o.a")).toBe(1);
    });
  });

  describe('receiving messages from other tabs', () => {
    it('creates observables created in other tabs', async () => {
      const tab = openTab();
      const s = await createState();
      tab.send({ type: "create-observable", name: "remote", data: { a: 1 } });

      await waitFor(async () => (await s.getValueFromObservable("remote")) !== null);
      expect(await s.getValueFromObservable("remote")).toEqual({ a: 1 });
    });

    it('does not write local storage, but still persists later local updates of persisted observables', async () => {
      const tab = openTab();
      const s = await createState();
      tab.send({ type: "create-observable", name: "remote", data: 1, options: { localStorage: true } });

      await waitFor(async () => (await s.getValueFromObservable("remote")) !== null);
      expect(localStorage.getItem("remote")).toBeNull();

      s.updateObservable("remote", 2);
      expect(JSON.parse(localStorage.getItem("remote")!)).toBe(2);
    });

    it('does not replace an observable that already has a real value', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("o", "mine", { broadcastCreation: false });
      tab.send({ type: "create-observable", name: "o", data: "theirs" });
      tab.send({ type: "create-observable", name: "marker", data: 1 });

      await waitFor(async () => (await s.getValueFromObservable("marker")) !== null);
      expect(await s.getValueFromObservable("o")).toBe("mine");
    });

    it('replaces a default value, and notifies the subscribers', async () => {
      const tab = openTab();
      const s = await createState();
      const listener = vi.fn();
      s.subscribeToObservable("o", "cmp", { "o": listener }, "default");

      tab.send({ type: "create-observable", name: "o", data: "theirs" });
      await waitFor(() => listener.mock.calls.length > 0);
      expect(listener).toHaveBeenCalledExactlyOnceWith("cmp", "o", "theirs");
    });

    it('applies updates, including updates of nested properties, without broadcasting them back', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("o", { a: { b: 1 } }, { broadcastCreation: false });

      tab.send({ type: "update-observable", name: "o.a.b", data: 2 });
      await waitFor(async () => (await s.getValueFromObservable("o.a.b")) === 2);

      await settle();
      expect(tab.ofType("update-observable")).toHaveLength(0);
    });

    it('creates the observable for a full-value update of an unknown one, but skips nested updates', async () => {
      const tab = openTab();
      const s = await createState();
      tab.send({ type: "update-observable", name: "ghost.x", data: 1 });
      tab.send({ type: "update-observable", name: "whole", data: { a: 1 } });

      await waitFor(async () => (await s.getValueFromObservable("whole")) !== null);
      expect(await s.getValueFromObservable("ghost")).toBeNull();
    });

    it('removes observables removed in other tabs, leaving the shared local storage to the tab that removed them', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("p", 1, { localStorage: true });

      tab.send({ type: "remove-observable", name: "p" });
      await waitFor(async () => (await s.getValueFromObservable("p")) === null);

      expect(localStorage.getItem("p")).not.toBeNull();
      expect((s as any).keysInLocalStorage.has("p")).toBe(false);
    });

    it('ignores malformed messages', async () => {
      const tab = openTab();
      const s = await createState();
      tab.raw("a string");
      tab.raw(null);
      tab.raw({ type: "bogus", senderId: "x", name: "x", time: 1, options: {} });
      tab.raw({ type: "update-observable" });
      tab.raw({ type: "create-observable", senderId: "x", name: "bad", time: 1 }); // no options
      tab.send({ type: "create-observable", name: "valid", data: 1 });

      await waitFor(async () => (await s.getValueFromObservable("valid")) !== null);
      expect(await s.getValueFromObservable("bad")).toBeNull();
    });

    it('ignores messages with invalid observable names', async () => {
      const tab = openTab();
      const s = await createState();
      tab.send({ type: "create-observable", name: "a.b", data: 1 });
      tab.send({ type: "create-observable", name: "", data: 1 });
      tab.send({ type: "create-observable", name: "valid", data: 1 });

      await waitFor(async () => (await s.getValueFromObservable("valid")) !== null);
      expect(await s.getValueFromObservable("a")).toBeNull();
    });
  });

  describe('initial state synchronisation', () => {
    it('requests the state from other tabs on creation', async () => {
      const tab = openTab();
      await createState(false);

      await waitFor(() => tab.ofType("request-state").length === 1);
      expect(typeof tab.ofType("request-state")[0].senderId).toBe("string");
    });

    it('applies the state it receives, which getValueFromObservable waits for', async () => {
      const tab = openTab();
      const s = await createState(false);
      const pending = s.getValueFromObservable("doc");

      await waitFor(() => tab.ofType("request-state").length === 1);
      tab.send({
        type: "receive-state",
        targetId: tab.ofType("request-state")[0].senderId,
        data: { doc: { value: { title: "T" }, localStorage: false } }
      });

      expect(await pending).toEqual({ title: "T" });
    });

    it('registers the persisted keys it receives, so that later updates are persisted', async () => {
      const tab = openTab();
      const s = await createState(false);

      await waitFor(() => tab.ofType("request-state").length === 1);
      tab.send({
        type: "receive-state",
        targetId: tab.ofType("request-state")[0].senderId,
        data: { p: { value: 1, localStorage: true } }
      });
      await waitFor(async () => (await s.getValueFromObservable("p")) !== null);

      s.updateObservable("p", 2);
      expect(JSON.parse(localStorage.getItem("p")!)).toBe(2);
    });

    it('ignores state addressed to other tabs, and only uses the first answer', async () => {
      const tab = openTab();
      const s = await createState(false);
      await waitFor(() => tab.ofType("request-state").length === 1);
      const targetId = tab.ofType("request-state")[0].senderId;

      tab.send({ type: "receive-state", targetId: "someone-else", data: { wrong: { value: 1, localStorage: false } } });
      tab.send({ type: "receive-state", targetId, data: { doc: { value: "first", localStorage: false } } });
      tab.send({ type: "receive-state", targetId, data: { doc: { value: "second", localStorage: false } } });

      await waitFor(async () => (await s.getValueFromObservable("doc")) !== null);
      await settle();
      expect(await s.getValueFromObservable("doc")).toBe("first");
      expect(await s.getValueFromObservable("wrong")).toBeNull();
    });

    it('replays the changes that arrived while waiting, on top of the received state', async () => {
      const tab = openTab();
      const s = await createState(false);
      await waitFor(() => tab.ofType("request-state").length === 1);
      const targetId = tab.ofType("request-state")[0].senderId;

      // the update is newer than the snapshot, although it arrives first
      tab.send({ type: "update-observable", name: "doc.count", data: 5 });
      await settle();
      tab.send({ type: "receive-state", targetId, data: { doc: { value: { count: 1 }, localStorage: false } } });

      await waitFor(async () => (await s.getValueFromObservable("doc")) !== null);
      expect(await s.getValueFromObservable("doc.count")).toBe(5);
    });

    it('gives up waiting for other tabs after a timeout', async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const s = await createState(false);

      let finished = false;
      const pending = s.getValueFromObservable("missing").then((v) => { finished = true; return v; });

      await vi.advanceTimersByTimeAsync(999);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBeNull();
    });

    it('answers the state requests of newer tabs, without the default values', async () => {
      const tab = openTab();
      const s = await createState();
      s.createObservable("a", { x: 1 }, { localStorage: true });
      s.createObservable("b", 2, { broadcastCreation: false });
      s.subscribeToObservable("c", "cmp", {}, "default");

      tab.send({ type: "request-state", senderId: "newer-tab", time: Date.now() + 10_000 });
      await waitFor(() => tab.ofType("receive-state").length === 1);

      const msg = tab.ofType("receive-state")[0];
      expect(msg.targetId).toBe("newer-tab");
      expect(msg.data).toEqual({
        a: { value: { x: 1 }, localStorage: true },
        b: { value: 2, localStorage: false }
      });
    });

    it('ignores the state requests of older tabs', async () => {
      const tab = openTab();
      await createState();

      tab.send({ type: "request-state", senderId: "older-tab", time: 0 });
      await settle();
      expect(tab.ofType("receive-state")).toHaveLength(0);
    });
  });
});
