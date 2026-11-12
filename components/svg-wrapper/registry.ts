// Registry of the icons that the app actually uses.
// Only icons listed here (via literal imports) end up in the bundle; do NOT use a glob over the whole icons folder.
//
// Usage (once, in the app's entry point):
//   registerIcons('google', {
//     home: () => import('library/lib-fe/icons/google/home.svg?raw'),
//     person: () => import('library/lib-fe/icons/google/person.svg?raw'),
//   });
// Then: <svg-wrapper set="google" name="home"></svg-wrapper>

export type IconLoader = () => Promise<{ default: string }> | Promise<string> | string;

const registry = new Map<string, IconLoader>();
const cache = new Map<string, string>();

const key = (set: string, name: string) => `${set}/${name}`;

export function registerIcons(set: string, icons: Record<string, IconLoader>) {
  for (const [name, loader] of Object.entries(icons)) registry.set(key(set, name), loader);
}

export async function loadIcon(set: string, name: string): Promise<string | null> {
  const k = key(set, name);
  const cached = cache.get(k);
  if (cached) return cached;

  const loader = registry.get(k);
  if (!loader) return null;

  const loaded = await loader();
  const raw = typeof loaded === 'string' ? loaded : loaded.default;
  const svg = prepareSvg(raw);
  cache.set(k, svg);
  return svg;
}

// Removes fixed dimensions from the root <svg> so that it scales with the wrapper (the viewBox is preserved).
function prepareSvg(raw: string): string {
  return raw.replace(/<svg\b[^>]*>/i, (tag) => tag.replace(/\s(width|height)="[^"]*"/gi, ''));
}
