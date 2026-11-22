export type MkLine = {
  id: string;
  next?: string;
  previous?: string;
  contents?: string;
}

export type MkDocument = {
  id: string;
  name: string;
  lines: Record<string, MkLine>; // a plain object: a Map does not survive JSON or structuredClone-based state
}

export const EmptyDocument = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Empty Document",
  lines: {},
}
