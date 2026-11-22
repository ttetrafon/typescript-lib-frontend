import { Logger } from "library/lib/services/logger";
import { Translations, Translator } from "library/lib-fe/services/translator";
import { resolveStyles } from "library/lib-fe/services/styles";
import resetStyles from 'library/lib-fe/styles/reset.css?inline';
import componentStyles from './styles.css?inline';
import templateHtml from './doc.html?raw';
import { convertMkToHTML } from "library/lib-fe/helper/mkEditor";
import { debounce } from "library/lib-fe/helper/timings";

const template: HTMLTemplateElement = document.createElement('template');
const componentName: string = "mk-line";
/** Default for the 'debounce-ms' attribute: how long the input has to be quiet before the editor is told about the new contents. */
const DEFAULT_LINE_UPDATE_DEBOUNCE_MS: number = 1000;

const sheet: CSSStyleSheet = new CSSStyleSheet();
sheet.replaceSync(
  `
  ${resetStyles}\n
  ${componentStyles}
  `
);

template.innerHTML = templateHtml;

export class HTMLMkLineElement extends HTMLElement {
  #shadow: ShadowRoot;
  private initialised: boolean = false;
  private l: Logger;
  private t: Translator;

  private textElements: Record<string, HTMLElement> = {};
  private translations: Record<string, Translations> = {};

  private lineUpdatedCb: ((id: string, contents: string) => void) | null = null;

  private inputField: HTMLTextAreaElement | null = null;
  private displayField: HTMLElement | null = null;

  // replaced whenever the 'debounce-ms' attribute changes
  private notifyLineUpdated = this.createNotifier(DEFAULT_LINE_UPDATE_DEBOUNCE_MS);

  constructor() {
    super();

    this.#shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#shadow.appendChild(template.content.cloneNode(true));

    this.l = Logger.getInstance();
    this.t = Translator.getInstance();
  }

  static get observedAttributes() { return ['label', 'data', 'debounce-ms', 'i18n', 'styles']; }

  get data() { return JSON.parse(this.getAttribute('data') ?? "{}"); }
  get debounceMs(): number {
    const value: number = Number.parseInt(this.getAttribute('debounce-ms') ?? "", 10);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LINE_UPDATE_DEBOUNCE_MS;
  }
  get i18n() { return this.getAttribute('i18n'); }
  get label() { return this.getAttribute('label'); }
  get styles() { return this.getAttribute('styles'); }

  set data(value: string) { this.setAttribute('data', value); }
  set debounceMs(value: number) { this.setAttribute('debounce-ms', value.toString()); }
  set i18n(value: string | null) { this.setAttribute('i18n', value ?? 'en'); }
  set label(value: string | null) { this.setAttribute('label', value ?? ""); }
  set styles(value: string | null) { this.setAttribute('styles', value ?? ""); }

  attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    this.l.debug(`---> attributeChangedCallback(${name}, ${oldVal}, ${newVal})`, componentName);
    if (oldVal == newVal) return;
    switch (name) {
      case 'debounce-ms':
        // do not lose a pending update when the wait changes
        this.notifyLineUpdated.flush();
        this.notifyLineUpdated = this.createNotifier(this.debounceMs);
        break;
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
      this.inputField = this.#shadow.querySelector("textarea");
      this.displayField = this.#shadow.querySelector("div.display");
      this.inputField?.addEventListener("input", () => {
        this.renderDisplay();
        this.notifyLineUpdated();
      });
      // on blur (the value changed), do not wait for the debounce
      this.inputField?.addEventListener("change", () => this.notifyLineUpdated.flush());
    }

    Object.keys(this.translations).forEach((t: string) => {
      const el: HTMLElement | null = this.#shadow.getElementById(t);
      if (!el) return;

      this.textElements[t] = el;
    });

    this.renderDisplay();

    this.initialised = true;
  }
  disconnectedCallback() {
    this.notifyLineUpdated.cancel();
    if (this.i18n && this.t) this.t.unregisterElementsForTranslations(this.i18n, this.textElements);
  }
  adoptedCallback() {
  }

  ///////////////
  //   SETUP   //
  ///////////////

  //////////////
  //   DATA   //
  //////////////

  private createNotifier(wait: number) {
    return debounce(() => {
      this.lineUpdatedCb?.(this.id, this.inputField?.value ?? "");
    }, wait);
  }

  private renderDisplay() {
    this.displayField?.replaceChildren(convertMkToHTML(this.inputField?.value ?? ""));
  }

  public setInputValue(value: string) {
    if (this.inputField) this.inputField.value = value;
    this.renderDisplay();
  }

  public setLineUpdatedCb(cb: (lineId: string, lineContents: string) => void) {
    if (!this.lineUpdatedCb) this.lineUpdatedCb = cb;
  }

  ///////////////
  //   .....   //
  ///////////////
}

window.customElements.define(componentName, HTMLMkLineElement);