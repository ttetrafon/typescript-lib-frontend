import { Logger } from "library/lib/services/logger";
import { resolveStyles } from "library/lib-fe/services/styles";
import { loadIcon } from './registry';
import resetStyles from 'library/lib-fe/styles/reset.css?inline';
import componentStyles from './styles.css?inline';
import templateHtml from './doc.html?raw';

export { registerIcons } from './registry';

const template: HTMLTemplateElement = document.createElement('template');
const componentName: string = "svg-wrapper";
const defaultSet: string = "google";

// The stylesheet is parsed once and shared by every instance through adoptedStyleSheets.
const sheet: CSSStyleSheet = new CSSStyleSheet();
sheet.replaceSync(`${resetStyles}\n${componentStyles}`);

template.innerHTML = templateHtml;

class SvgWrapper extends HTMLElement {
  #shadow: ShadowRoot;
  private l: Logger;

  private container: HTMLElement;
  private loadToken: number = 0;

  constructor() {
    super();

    this.#shadow = this.attachShadow({ mode: 'open' });
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#shadow.appendChild(template.content.cloneNode(true));
    this.container = this.#shadow.getElementById('icon') as HTMLElement;

    this.l = Logger.getInstance();
  }

  static get observedAttributes() { return ['name', 'set', 'styles']; }

  get name() { return this.getAttribute('name') ?? ""; }
  get set() { return this.getAttribute('set') || defaultSet; }
  // A space or comma separated list of stylesheet names registered by the app through `registerStyles()`.
  get styles() { return this.getAttribute('styles'); }

  set name(value: string) { this.setAttribute('name', value); }
  set set(value: string) { this.setAttribute('set', value); }
  set styles(value: string | null) { this.setAttribute('styles', value ?? ""); }

  attributeChangedCallback(attr: string, oldVal: string | null, newVal: string | null) {
    if (oldVal === newVal) return;
    if (attr === 'styles') {
      this.#shadow.adoptedStyleSheets = [sheet, ...resolveStyles(newVal)];
      return;
    }
    if (this.isConnected) this.render();
  }
  connectedCallback() {
    this.render();
  }

  private async render() {
    const token = ++this.loadToken; // guard against out-of-order loads when attributes change quickly
    const { set, name } = this;

    if (!name) {
      this.container.innerHTML = "";
      return;
    }

    try {
      const svg = await loadIcon(set, name);
      if (token !== this.loadToken) return;

      if (svg === null) {
        this.l.warn(`Icon '${set}/${name}' is not registered; use registerIcons() to include it.`, componentName);
        this.container.innerHTML = "";
        return;
      }
      // The markup comes from bundled files only, never from user input.
      this.container.innerHTML = svg;
    } catch (e) {
      this.l.warn(`Failed to load icon '${set}/${name}': ${e}`, componentName);
    }
  }
}

window.customElements.define(componentName, SvgWrapper);