import { Logger } from "library/lib/services/logger";
import { Translations, Translator } from "library/lib-fe/services/translator";
import { State } from "library/lib-fe/services/state";
import { resolveStyles } from "library/lib-fe/services/styles";
import resetStyles from 'library/lib-fe/styles/reset.css?inline';
import componentStyles from './styles.css?inline';
import templateHtml from './doc.html?raw';

const template: HTMLTemplateElement = document.createElement('template');
const componentName: string = "mk-line";

const sheet: CSSStyleSheet = new CSSStyleSheet();
sheet.replaceSync(`${resetStyles}\n${componentStyles}`);

template.innerHTML = templateHtml;

class MkLine extends HTMLElement {
  #shadow: ShadowRoot;
  private initialised: boolean = false;
  private l: Logger;
  private t: Translator;
  private s: State | null = null;

  private index: number = -1;

  private textElements: Record<string, HTMLElement> = {};
  private translations: Record<string, Translations> = {};

  private positionIndicator: HTMLSpanElement | null = null;
  private inputField: HTMLTextAreaElement | null = null;

  constructor() {
    super();

    this.#shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#shadow.appendChild(template.content.cloneNode(true));

    this.l = Logger.getInstance();
    this.t = Translator.getInstance();
    this.s = State.getInstance("...");
  }

  static get observedAttributes() { return ['label', 'data', 'i18n', 'styles']; }

  // Attribute values are always strings, so we need to convert them in their getter/setters as appropriate.
  get data() { return JSON.parse(this.getAttribute('data') ?? "{}"); }
  get i18n() { return this.getAttribute('i18n'); }
  get label() { return this.getAttribute('label'); }
  get styles() { return this.getAttribute('styles'); }

  set data(value: string) { this.setAttribute('data', value); }
  set i18n(value: string | null) { this.setAttribute('i18n', value ?? 'en'); }
  set label(value: string | null) { this.setAttribute('label', value ?? ""); }
  set styles(value: string | null) { this.setAttribute('styles', value ?? ""); }

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
    if (this.initialised) return;

    Object.keys(this.translations).forEach((t: string) => {
      const el: HTMLElement | null = this.#shadow.getElementById(t);
      if (!el) return;

      this.textElements[t] = el;
    });

    this.positionIndicator = this.#shadow.querySelector("span#pos");
    this.inputField = this.#shadow.querySelector("textarea");

    this.initialised = true;
  }
  disconnectedCallback() {
    if (this.i18n && this.t) this.t.unregisterElementsForTranslations(this.i18n, this.textElements);
  }
  adoptedCallback() {
  }

  public getPositionIndex(): number {
    if (this.index < 0) {
      const prev: ChildNode | null = this.#shadow.previousSibling;
      if (!prev) {
        this.index = 0;
      }
      else {
        this.index = (prev as MkLine).getPositionIndex();
      }
    }
    return this.index;
  }

  public updateLineNumber() {
    setTimeout(() => {
      this.index = -1;
      if (this.positionIndicator) {
        this.positionIndicator.innerText = this.getPositionIndex().toString();
      }
    }, 0);
  }

  public setInputValue(value: string) {
    if (this.inputField) this.inputField.value = value;
  }
}

window.customElements.define(componentName, MkLine);