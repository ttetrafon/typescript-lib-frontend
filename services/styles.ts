/**
 * Registry of named, shareable stylesheets for web-components.
 *
 * An app registers a stylesheet under a name (typically from a `?inline` import), and a component
 * that has that name in its `styles` attribute adopts it into its shadow-root:
 *
 *   registerStyles('app-404', app404Css);
 *   <page-404 styles="app-404"></page-404>
 *
 * Every name maps to exactly one CSSStyleSheet, parsed once and shared by all the components that use it.
 * A name can be requested before it is registered; the sheet is created empty and is filled in on registration,
 * and any component already using it is updated automatically.
 */
const registry: Map<string, CSSStyleSheet> = new Map();

function getSheet(name: string): CSSStyleSheet {
  let sheet = registry.get(name);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    registry.set(name, sheet);
  }
  return sheet;
}

/** Registers (or replaces the content of) the named stylesheet. */
export function registerStyles(name: string, css: string): CSSStyleSheet {
  const sheet = getSheet(name);
  sheet.replaceSync(css);
  return sheet;
}

/** Resolves a space or comma separated list of stylesheet names (e.g. the value of a `styles` attribute). */
export function resolveStyles(names: string | null | undefined): CSSStyleSheet[] {
  if (!names) return [];
  return names.split(/[\s,]+/).filter(Boolean).map(getSheet);
}
