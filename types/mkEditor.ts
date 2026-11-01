export type MkLine = {
  id: string;
  next: string;
  previous?: string;
  contents?: string;
}

export type MkDocument = {
  id: string;
  name: string;
  root?: string;
  lines: Map<string, MkLine>;
}
