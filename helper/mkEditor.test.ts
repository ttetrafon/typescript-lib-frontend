import { describe, expect, it } from "vitest";
import { convertMkToHTML } from "./mkEditor";

const html = (mk: string) => convertMkToHTML(mk).innerHTML;

describe("convertMkToHTML", () => {
  it("makes headings and paragraphs", () => {
    expect(html("# Title")).toBe("<h1>Title</h1>");
    expect(html("###### Small")).toBe("<h6>Small</h6>");
    expect(html("####### seven")).toBe("<p>####### seven</p>");
    expect(html("#nospace")).toBe("<p>#nospace</p>");
    expect(html("plain")).toBe("<p>plain</p>");
  });

  it("makes one block per line", () => {
    expect(html("a\n## b\n\nc")).toBe("<p>a</p><h2>b</h2><p><br></p><p>c</p>");
  });

  it("formats inline text", () => {
    expect(html("a **b** c")).toBe("<p>a <strong>b</strong> c</p>");
    expect(html("a _b_ c")).toBe("<p>a <em>b</em> c</p>");
    expect(html("a *b* c")).toBe("<p>a <em>b</em> c</p>");
    expect(html("a __b__ c")).toBe("<p>a <u>b</u> c</p>");
    expect(html("a -b- c")).toBe("<p>a <s>b</s> c</p>");
  });

  it("nests formatting", () => {
    expect(html("**bold _and italic_**")).toBe("<p><strong>bold <em>and italic</em></strong></p>");
    expect(html("***both***")).toBe("<p><strong><em>both</em></strong></p>");
    expect(html("*a **b** c*")).toBe("<p><em>a <strong>b</strong> c</em></p>");
  });

  it("leaves words with inner markers and unmatched markers alone", () => {
    expect(html("snake_case_name")).toBe("<p>snake_case_name</p>");
    expect(html("a well-known re-do")).toBe("<p>a well-known re-do</p>");
    expect(html("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
    expect(html("**open")).toBe("<p>**open</p>");
  });

  it("supports escapes", () => {
    expect(html("\\*not italic\\*")).toBe("<p>*not italic*</p>");
  });

  it("never turns text into markup", () => {
    expect(html("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });
});
