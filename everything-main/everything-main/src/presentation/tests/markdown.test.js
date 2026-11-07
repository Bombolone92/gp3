import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Just enough DOM for ui.js's el(): element trees whose text can be read back.
class FakeNode {
  constructor(tag, text = "") {
    this.tagName = tag;
    this.text = text;
    this.childNodes = [];
  }
  setAttribute() {}
  addEventListener() {}
  append(...nodes) {
    this.childNodes.push(...nodes);
  }
  get textContent() {
    return this.tagName === "#text"
      ? this.text
      : this.childNodes.map((n) => n.textContent).join("");
  }
}

let renderMarkdown;
const saved = {};
beforeAll(async () => {
  for (const key of ["document", "Node"]) saved[key] = globalThis[key];
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => new FakeNode("#text", text),
    createDocumentFragment: () => new FakeNode("#fragment"),
  };
  ({ renderMarkdown } = await import("../src/markdown.js"));
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) globalThis[key] = value;
});

describe("renderMarkdown headings", () => {
  const heading = (text) => renderMarkdown(text).childNodes[0];

  it("keeps a trailing # that belongs to the heading text", () => {
    expect(heading("## Learn C#").textContent).toBe("Learn C#");
    expect(heading("### F# and C#").textContent).toBe("F# and C#");
  });

  it("still strips a space-separated closing sequence", () => {
    expect(heading("## Title ##").textContent).toBe("Title");
    expect(heading("# Issue #42 #").textContent).toBe("Issue #42");
    expect(heading("## ##").textContent).toBe("");
  });
});
