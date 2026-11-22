import { Logger } from "library/lib/services/logger";
import { Translations, Translator } from "library/lib-fe/services/translator";
import { State } from "library/lib-fe/services/state";
import { resolveStyles } from "library/lib-fe/services/styles";
import { EmptyDocument, MkDocument, MkLine } from "library/lib-fe/types/mkEditor";
import { HTMLMkLineElement } from "../mk-line/script";
import resetStyles from 'library/lib-fe/styles/reset.css?inline';
import componentStyles from './styles.css?inline';
import templateHtml from './doc.html?raw';
import { Navigator } from "library/lib-fe/services/navigator";

const template: HTMLTemplateElement = document.createElement('template');
const componentName: string = "mk-editor";

const sheet: CSSStyleSheet = new CSSStyleSheet();
sheet.replaceSync(`${resetStyles}\n${componentStyles}`);

template.innerHTML = templateHtml;

class MkEditor extends HTMLElement {
  #shadow: ShadowRoot;
  private initialised: boolean = false;
  private l: Logger;
  private t: Translator;
  private s: State | null = null;

  private textElements: Record<string, HTMLElement> = {};
  private translations: Record<string, Translations> = {};

  private editorId: string | null = null;
  private mkDocument: MkDocument | null = null;
  private container: HTMLElement | null = null;
  private lines: Record<string, HTMLMkLineElement> = {}; // id -> mk-line element

  constructor() {
    super();

    this.#shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.#shadow.adoptedStyleSheets = [sheet];
    this.#shadow.appendChild(template.content.cloneNode(true));

    this.l = Logger.getInstance();
    this.t = Translator.getInstance();
  }

  static get observedAttributes() { return ['app-name', 'debounce-ms', 'i18n', 'document-id', 'styles']; }

  get appName() { return this.getAttribute('app-name') ?? ""; }
  /** How long a line's input has to be quiet before it is reported; null = the mk-line default. */
  get debounceMs(): number | null {
    const value: number = Number.parseInt(this.getAttribute('debounce-ms') ?? "", 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  get documentId() { return this.getAttribute('document-id') ?? ""; }
  get i18n() { return this.getAttribute('i18n'); }
  get styles() { return this.getAttribute('styles'); }

  set appName(value: string | null) { this.setAttribute('app-name', value ?? ""); }
  set debounceMs(value: number | null) {
    if (value === null) this.removeAttribute('debounce-ms');
    else this.setAttribute('debounce-ms', value.toString());
  }
  set documentId(value: string) { this.setAttribute('document-id', value) }
  set styles(value: string | null) { this.setAttribute('styles', value ?? ""); }
  set i18n(value: string | null) { this.setAttribute('i18n', value ?? 'en'); }

  attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    this.l.debug(`---> ${this.editorId?.toUpperCase()}.attributeChangedCallback(${name}, ${oldVal}, ${newVal})`);
    if (oldVal == newVal) return;
    switch (name) {
      case 'app-name':
      case 'document-id':
        if (this.documentId) this.editorId = `${componentName}::${this.documentId}`;
        this.setupState();
        this.setupDocument();
        break;
      case 'debounce-ms':
        Object.values(this.lines).forEach((el: HTMLMkLineElement) => this.passDebounceTo(el));
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
    if (this.initialised) return;

    this.container = this.#shadow.querySelector("article");

    Object.keys(this.translations).forEach((t: string) => {
      const el: HTMLElement | null = this.#shadow.getElementById(t);
      if (!el) return;

      this.textElements[t] = el;

    });

    this.setupState();
    this.setupDocument();

    this.initialised = true;
  }
  disconnectedCallback() {
    if (this.i18n && this.t) this.t.unregisterElementsForTranslations(this.i18n, this.textElements);
  }
  adoptedCallback() {
  }

  ///////////////
  //   SETUP   //
  ///////////////

  private async setupDocument() {
    this.l.debug(`---> ${this.editorId?.toUpperCase()}.setupDocument()`);
    if (!this.s || !this.documentId || !this.editorId) return;

    this.s.subscribeToObservable(this.documentId, this.editorId, { [this.documentId]: this.documentUpdatedCb.bind(this) }, EmptyDocument);
    this.s.getValueFromObservable<MkDocument>(this.documentId).then(doc => {
      if (doc) this.documentUpdatedCb(this.editorId!, this.documentId, doc);
    });
  }

  private async setupState() {
    this.l.debug(`---> ${this.editorId?.toUpperCase()}.setupState()`);
    if (!this.appName || this.appName.length === 0 || this.s) return;

    this.s = State.getInstance(this.appName);
  }

  ///////////////////////
  //   DATA HANDLING   //
  ///////////////////////

  private createLine(id: string, line: MkLine) {
    this.l.debug(`---> ${this.editorId?.toUpperCase()}.createLine(${id})`, line);

    // First check if the line already exists, and it is already in the document update it instead
    let el = this.lines[id];
    if (!el) {
      el = document.createElement("mk-line") as HTMLMkLineElement;
      el.id = id;
      this.passDebounceTo(el);
      el.setLineUpdatedCb(this.mkLineUpdatedCb.bind(this));
      this.lines[id] = el;
      this.insertLineIntoDocument(line, el);
    }

    el.setInputValue(line.contents ?? "");
  }

  /** Pass the editor's 'debounce-ms' on to a line; without it, the line uses its own default. */
  private passDebounceTo(el: HTMLMkLineElement) {
    const value: number | null = this.debounceMs;
    if (value === null) el.removeAttribute('debounce-ms');
    else el.debounceMs = value;
  }

  private documentUpdatedCb(subscriber: string, watchedPath: string, updatedValue: any) {
    this.l.debug(`---> ${this.editorId?.toUpperCase()}.documentUpdatedCb(subscriber=${subscriber}, watchedPath=${watchedPath})`, updatedValue);
    if (subscriber !== this.editorId) return;

    const updatedDocument = updatedValue as MkDocument;
    if (updatedDocument.id !== this.documentId) return;

    this.mkDocument = updatedDocument;

    // Update page metadata through the Navigator
    Navigator.setMetadata({
      title: updatedDocument.name,
      description: updatedDocument.name,
    });

    // Remove deleted lines
    Object.keys(this.lines).forEach((id: string) => {
      if (!Object.hasOwn(updatedDocument.lines, id)) {
        this.lines[id].remove();
        delete this.lines[id];
      }
    });

    // Add/Update lines, in document order
    const ordered = this.orderedLines(updatedDocument);
    for (const line of ordered) {
      this.createLine(line.id, line);
    }

    // Make sure the DOM order matches the document order (handles moved lines)
    let ref: Element | null = this.container?.firstElementChild ?? null;
    for (const line of ordered) {
      const el = this.lines[line.id];
      if (el === ref) ref = ref.nextElementSibling;
      else this.container?.insertBefore(el, ref);
    }
  }

  private insertLineIntoDocument(line: MkLine, el: HTMLMkLineElement) {
    if (!this.container) return;

    const previous = line.previous ? this.lines[line.previous] : undefined;
    const next = line.next ? this.lines[line.next] : undefined;

    if (previous) previous.after(el);
    else if (next) next.before(el); // single-line insert before an existing line
    else this.container.prepend(el); // new head or empty document
  }

  /** Walk the previous/next linked list from the head; unreachable lines go last. */
  private orderedLines(doc: MkDocument): MkLine[] {
    const lines = doc.lines;
    const head = Object.values(lines).find(l => !l.previous || !lines[l.previous]);
    const ordered: MkLine[] = [];
    const seen = new Set<string>();
    for (let l = head; l && !seen.has(l.id); l = l.next ? lines[l.next] : undefined) {
      seen.add(l.id);
      ordered.push(l);
    }
    for (const l of Object.values(lines)) if (!seen.has(l.id)) ordered.push(l);
    return ordered;
  }

  /**
   * Passed into MkLines created within the document, to be called when the line contents are updated.
   * @param lineId
   * @param lineContents
   */
  private mkLineUpdatedCb(lineId: string, lineContents: string) {
    this.l.debug(`---> ${this.editorId?.toUpperCase()}.mkLineUpdatedCb(lineId='${lineId}', lineContents='${lineContents}')`);

  }

  ///////////////
  //   .....   //
  ///////////////
}

window.customElements.define(componentName, MkEditor);