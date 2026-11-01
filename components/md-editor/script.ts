import { Logger } from "library/lib/services/logger";
import { Translations, Translator } from "library/lib-fe/services/translator";
import { State } from "library/lib-fe/services/state";
import resetStyles from 'library/lib-fe/styles/reset.css?inline';
import componentStyles from './styles.css?inline';
import templateHtml from './doc.html?raw';
import { MkDocument } from "library/lib-fe/types/mkEditor";

const template: HTMLTemplateElement = document.createElement('template');
const componentName: string = "mk-editor";

template.innerHTML = /*html*/`
<style>
  ${resetStyles}
  ${componentStyles}
</style>

${templateHtml}
`;

class MkEditor extends HTMLElement {
  #shadow: ShadowRoot;
  private initialised: boolean = false;
  private l: Logger;
  private t: Translator;
  private s: State | null = null;

  private textElements: Record<string, HTMLElement> = {};
  private translations: Record<string, Translations> = {};

  private documentTitle: HTMLElement | null = null;
  private document: MkDocument | null = null;

  constructor() {
    super();

    this.#shadow = this.attachShadow({ mode: 'open' });

    template.shadowRootDelegatesFocus = true;
    this.#shadow.appendChild(template.content.cloneNode(true));

    this.l = Logger.getInstance();
    this.t = Translator.getInstance();
  }

  static get observedAttributes() { return ['app-name', 'i18n', 'document-id']; }

  get appName() { return this.getAttribute('app-name') ?? ""; }
  get documentId() { return this.getAttribute('document-id') ?? ""; }
  get i18n() { return this.getAttribute('i18n'); }

  set appName(value: string | null) { this.setAttribute('app-name', value ?? ""); }
  set documentId(value: string) { this.setAttribute('documentId', value) }
  set i18n(value: string | null) { this.setAttribute('i18n', value ?? 'en'); }

  attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    this.l.debug(`---> attributeChangedCallback(${name}, ${oldVal}, ${newVal})`, componentName);
    if (oldVal == newVal) return;
    switch (name) {
      case 'app-name':
        this.setupState();
        break;
      case 'i18n':
        this.t?.registerElementsForTranslations(newVal, this.textElements, this.translations);
        break;
      default:
        break;
    }
  }
  connectedCallback() {
    if (this.initialised) return;

    this.documentTitle = this.#shadow.querySelector("h1");

    Object.keys(this.translations).forEach((t: string) => {
      const el: HTMLElement | null = this.#shadow.getElementById(t);
      if (!el) return;

      this.textElements[t] = el;
    });

    this.setupState();
    this.initialised = true;
  }
  disconnectedCallback() {
    if (this.i18n && this.t) this.t.unregisterElementsForTranslations(this.i18n, this.textElements);
  }
  adoptedCallback() {
  }

  private async setupState() {
    if (!this.appName || this.appName.length === 0 || this.s) return;
    this.s = State.getInstance(this.appName);
    const doc = await this.s.getValueFromObservable("0001-test-1000") as MkDocument;
    this.setDocument(doc);
  }

  public setDocument(document: MkDocument) {
    if (this.document) return; // Initial document setup should happen only once.

    this.document = document;
    if (this.documentTitle) this.documentTitle.textContent = this.document.name;
  }
}

window.customElements.define(componentName, MkEditor);