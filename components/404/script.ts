import { Logger } from "library/lib/services/logger";
import { Navigator } from "library/lib-fe/services/navigator";
import { Translations, Translator } from "library/lib-fe/services/translator";
import { resolveStyles } from "library/lib-fe/services/styles";
import resetStyles from 'library/lib-fe/styles/reset.css?inline';
import componentStyles from './styles.css?inline';
import templateHtml from './doc.html?raw';

const template: HTMLTemplateElement = document.createElement('template');
const componentName: string = "page-404";

const sheet: CSSStyleSheet = new CSSStyleSheet();
sheet.replaceSync(`${resetStyles}\n${componentStyles}`);

template.innerHTML = templateHtml;

class Component extends HTMLElement {
  #shadow: ShadowRoot;
  private initialised: boolean = false;
  private l: Logger;
  private t: Translator;

  private textElements: Record<string, HTMLElement> = {};
  private translations: Record<string, Translations> = {};

  constructor() {
    super();

    this.#shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#shadow.appendChild(template.content.cloneNode(true));

    this.l = Logger.getInstance();
    this.t = Translator.getInstance();
  }

  static get observedAttributes() { return ['label', 'data', 'i18n', 'styles']; }

  get data() { return JSON.parse(this.getAttribute('data') ?? "{}"); }
  get label() { return this.getAttribute('label'); }
  get i18n() { return this.getAttribute('i18n'); }
  get styles() { return this.getAttribute('styles'); }

  set styles(value: string | null) { this.setAttribute('styles', value ?? ""); }
  set data(value: string) { this.setAttribute('data', value); }
  set label(value: string | null) { this.setAttribute('label', value ?? ""); }
  set i18n(value: string | null) { this.setAttribute('i18n', value ?? 'en'); }

  attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    this.l.debug(`---> attributeChangedCallback(${name}, ${oldVal}, ${newVal})`, componentName);
    if (oldVal == newVal) return;
    switch (name) {
      case 'i18n':
        this.t?.registerElementsForTranslations(newVal, this.textElements, this.translations);
        break;
      case 'styles':
        this.#shadow.adoptedStyleSheets = [sheet, ...resolveStyles(newVal)];
        break;
      default:
        break;
    }
  }
  connectedCallback() {
    if (!this.initialised) {
      const home = this.#shadow.querySelector("a#home") as HTMLAnchorElement;
      if (home) home.addEventListener("click", e => Navigator.followLink(home, "/", e));

      this.initialised = true;
    }

    Object.keys(this.translations).forEach((t: string) => {
      const el: HTMLElement | null = this.#shadow.getElementById(t);
      if (!el) return;

      this.textElements[t] = el;
    });
  }
  disconnectedCallback() {
    if (this.i18n && this.t) this.t.unregisterElementsForTranslations(this.i18n, this.textElements);
  }
  adoptedCallback() {
  }
}

window.customElements.define(componentName, Component);