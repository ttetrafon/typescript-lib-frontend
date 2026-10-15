import { Logger } from "library/lib/services/logger";

export type Translations = {
  text?: Record<string, string>;
  alt?: Record<string, string>;
  ariaLabel?: Record<string, string>;
  placeholder?: Record<string, string>;
  title?: Record<string, string>;
};

export class Translator {
  static #instance: Translator;
  _logger: Logger;
  _lang: string = 'en';
  _textElements: Map<string, Set<HTMLElement>> = new Map();
  _translations: Map<string, Translations> = new Map();

  private constructor() {
    this._logger = Logger.getInstance();
    this.checkAndSaveLanguage();
  }

  public static getInstance(): Translator {
    return this.#instance ??= new Translator();
  }

  private checkAndSaveLanguage() {
    this._lang = document.documentElement.lang;
  }

  public static getLanguage() {
    return this.#instance._lang;
  }

  // Target Elements

  public addTextElement(key: string, element: HTMLElement) {
    this._logger.debug(`---> addTextElement(${key})`);
    if (this._textElements.has(key)) {
      this._textElements.get(key)?.add(element);
    }
    else {
      this._textElements.set(key, new Set([element]));
    }
    this._logger.debug(`... ${key}: has ${this._textElements.get(key)?.size} elements registered.`);

    this.applyElementTranslation(key, element);
  }

  public addTextElements(elements: Record<string, HTMLElement>) {
    this._logger.debug(`---> addTextElements()`);
    for (const [key, el] of Object.entries(elements)) {
      this.addTextElement(key, el);
    }
  }

  public removeTextElement(key: string, element: HTMLElement) {
    this._logger.debug(`---> removeTextElement(${key})`);
    const entry = this._textElements.get(key);
    if (!entry) return;

    entry.delete(element);
  }

  // Translations

  public addTranslation(key: string, translation: Translations) {
    this._logger.debug(`---> addTranslation(${key}, ${JSON.stringify(translation)})`);
    const entry = this._translations.get(key);
    if (entry) {
      entry.text = translation.text;
      if (translation.ariaLabel) {
        entry.ariaLabel = translation.ariaLabel;
      }
    }
    else {
      this._translations.set(key, translation);
    }
  }

  public removeTranslation(key: string) {
    this._logger.debug(`---> removeTranslation(${key})`);
    this._translations.delete(key);
  }

  public addTranslations(translations: Record<string, Translations>) {
    this._logger.debug("---> addTranslations()");
    for (const [key, tr] of Object.entries(translations)) {
      this.addTranslation(key, tr);
    }
  }

  public removeTranslations(keys: string[]) {
    this._logger.debug(`---> removeTranslation()`);
    keys.forEach((k: string) => {
      this._translations.delete(k);
    });
  }

  public async applyElementTranslation(key: string, el: HTMLElement) {
    this._logger.debug(`---> applyElementTranslation(${key})`);
    setTimeout(() => {
      const tr = this._translations.get(key);
      if (!tr) return;

      const text = tr.text?.[this._lang];
      if (text && el.textContent.length > 0) el.textContent = text;

      const alt = tr.alt?.[this._lang];
      if (alt) (el as HTMLImageElement).alt = alt;

      const ariaLabel = tr.ariaLabel?.[this._lang];
      if (ariaLabel) el.setAttribute('aria-label', ariaLabel);

      const placeholder = tr.placeholder?.[this._lang];
      if (placeholder) (el as HTMLInputElement).placeholder = placeholder;
      if (placeholder) (el as HTMLInputElement).ariaPlaceholder = placeholder;

      const title = tr.title?.[this._lang];
      if (title) el.title = title;
    }, 0);
  }

  public async applyMetaTranslations() {
    const title = this._translations.get('page-title')?.text?.[this._lang];
    if (title) document.title = title;

    const description = this._translations.get('page-description')?.text?.[this._lang];
    if (description) {
      let meta: HTMLMetaElement | null = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'description';
        document.head.appendChild(meta);
      }
      meta.content = description;
    }
  }

  public async applyAllTranslations(language?: string) {
    this._logger.debug(`---> applyAllTranslations()`);
    language ? this._lang = language : this.checkAndSaveLanguage();

    this.applyMetaTranslations();
    for (const [key, els] of this._textElements) {
      els.forEach((el: HTMLElement) => this.applyElementTranslation(key, el));
    }
  }

  // HELPERS

  registerElementsForTranslations(i18n: string, textElements: Record<string, HTMLElement>, translations: Record<string, Translations>) {
    for (const [id, el] of Object.entries(textElements)) {
      const key: string = `${i18n}-${id}`;
      this.addTranslation(key, translations[id]);
      this.addTextElement(key, el);
    }
  }

  unregisterElementsForTranslations(i18n: string, textElements: Record<string, HTMLElement>) {
    for (const [id, el] of Object.entries(textElements)) {
      const key: string = `${i18n}-${id}`;
      this.removeTranslation(key);
      this.removeTextElement(key, el);
    }
  }
}
