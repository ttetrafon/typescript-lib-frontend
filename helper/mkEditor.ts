type InlineMarker = {
  marker: string;
  tag: "strong" | "em" | "u" | "s";
  /** Markers that must not start or end inside a word, so that snake_case and well-known stay untouched. */
  wordBounded: boolean;
};

// The order matters: longer markers first.
const INLINE_MARKERS: InlineMarker[] = [
  { marker: "**", tag: "strong", wordBounded: false },
  { marker: "__", tag: "u", wordBounded: true },
  { marker: "*", tag: "em", wordBounded: false },
  { marker: "_", tag: "em", wordBounded: true },
  { marker: "-", tag: "s", wordBounded: true },
];

const HEADING = /^(#{1,6})\s+(.*)$/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;

/**
 * Convert markdown-like text to DOM elements. Nothing is written with innerHTML, so the text can never inject markup.
 * Every line of the text becomes one block (a heading or a paragraph) inside the returned wrapper.
 * Block syntax: "# " to "###### " -> h1 to h6.
 * Inline syntax: **bold**, _italic_ or *italic*, __underline__, -strikethrough-; they can be nested, and a backslash escapes the next character.
 */
export function convertMkToHTML(mk: string): HTMLElement {
  const wrapper = document.createElement("div");
  for (const line of mk.split(/\r?\n/)) {
    wrapper.appendChild(convertBlock(line));
  }
  return wrapper;
}

function convertBlock(line: string): HTMLElement {
  const heading = HEADING.exec(line);
  const el = document.createElement(heading ? `h${heading[1].length}` : "p");
  const text = heading ? heading[2] : line;

  if (text.trim().length === 0) el.appendChild(document.createElement("br")); // keep the height of empty lines
  else parseInline(text, el);

  return el;
}

function parseInline(text: string, parent: Node) {
  let buffer = "";
  const flush = () => {
    if (buffer.length === 0) return;
    parent.appendChild(document.createTextNode(buffer));
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    const found = matchInline(text, i);
    if (found) {
      flush();
      const el = document.createElement(found.def.tag);
      parseInline(text.slice(i + found.def.marker.length, found.close), el);
      parent.appendChild(el);
      i = found.close + found.def.marker.length;
      continue;
    }

    buffer += text[i];
    i++;
  }
  flush();
}

/** Check if a formatted span opens at position i, and find where it closes. */
function matchInline(text: string, i: number): { def: InlineMarker; close: number } | null {
  for (const def of INLINE_MARKERS) {
    const { marker, wordBounded } = def;
    if (!text.startsWith(marker, i)) continue;

    const next = text[i + marker.length];
    if (next === undefined || WHITESPACE.test(next)) continue;
    if (marker.length === 1 && next === marker) continue; // the start of a double marker that did not match
    if (wordBounded && i > 0 && WORD_CHAR.test(text[i - 1])) continue;

    const close = findClosing(text, def, i + marker.length);
    if (close >= 0) return { def, close };
  }
  return null;
}

/** Find the closing marker, searching from the start of the (non-empty) content. */
function findClosing(text: string, def: InlineMarker, contentStart: number): number {
  const { marker, wordBounded } = def;
  for (let j = contentStart + 1; j <= text.length - marker.length; j++) {
    if (text[j] === "\\") {
      j++; // skip the escaped character
      continue;
    }
    if (!text.startsWith(marker, j)) continue;
    if (WHITESPACE.test(text[j - 1])) continue;
    if (marker.length === 1 && (text[j - 1] === marker || text[j + 1] === marker)) continue; // part of a double marker

    const after = text[j + marker.length];
    if (wordBounded && after !== undefined && WORD_CHAR.test(after)) continue;

    // in a longer run (e.g. "***"), close with the last characters, so that the inner span can close first
    let close = j;
    while (text[close + marker.length] === marker[0]) close++;
    return close;
  }
  return -1;
}
