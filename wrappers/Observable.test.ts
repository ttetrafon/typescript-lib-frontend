import { describe, it, expect, vi } from 'vitest'
import { Observable } from './Observable';

describe('Observable', () => {
  describe('constructor', () => {
    it('should create an object with any value is not provided', async () => {
      const l: any[] = [
        ["o1", 123],
        ["o2", "some text"],
        ["o3", { v: 1, c: 3, p: 3.14 }]
      ]

      l.forEach(i => {
        expect(new Observable(i[0], i[1])).toBeDefined();
      });
    });
  });

  describe('get', () => {
    const v: object = {
      a: 1,
      b: 2,
      c: 4,
      d: {
        e: 8,
        f: 16,
        g: {
          h: 32
        }
      }
    };
    const obs: Observable = new Observable("obs", v);

    it('should return the requested property', async () => {
      expect(obs.get()).toMatchObject(v);
      expect(obs.get("obs")).toMatchObject(v);
      expect(obs.get("obs.b")).toBe((v as Record<string, any>).b);
    });

    it('should throw an error if an erroneous key has been requested', async () => {
      expect(() => obs.get("obs.b.c")).toThrow();
    });
  });

  describe('set', () => {
    const v: object = {
      a: 1,
      b: 2,
      c: 4,
      d: {
        e: 8,
        f: 16,
        g: {
          h: 32
        }
      }
    };
    const obs: Observable = new Observable("obs", v);

    it('should update the requested value', async () => {
      obs.set("obs.a", 5);
      expect(obs.get("obs.a")).toBe(5);
    });

    it('should throw an error when trying to update an erroneous property', async () => {
      expect(() => obs.set("obs.a.b", 10));
    });
  });
});
