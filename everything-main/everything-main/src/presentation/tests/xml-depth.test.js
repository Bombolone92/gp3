import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import {
  elem,
  qname,
  parseXml,
  serializeXml,
  XmlParseError,
} from "../lib/pptx/src/internal/xml/index.ts";

describe("deep XML parts", () => {
  it("parses and serializes deep namespace scopes without call-stack growth", () => {
    const depth = 20000;
    const open = Array.from(
      { length: depth },
      (_, i) => `<p:n xmlns:q="urn:scope${i % 2}" q:i="${i}" plain="x">`,
    ).join("");
    const source = `<?xml version="1.0"?><!--before--><p:root xmlns:p="urn:root" xmlns:q="urn:outer" xmlns="urn:default">${open}text&amp;&#13;<![CDATA[<literal>]]><!--comment--><?target value?><q:leaf/>${"</p:n><q:sibling/>".repeat(depth)}</p:root><?after?>`;
    const document = parseXml(source);
    let parent = document.root;
    for (let i = 0; i < depth; i++) {
      const node = parent.children[0];
      assert.equal(node.name.namespaceURI, "urn:root");
      assert.equal(node.attrs[0].name.namespaceURI, `urn:scope${i % 2}`);
      assert.equal(node.attrs[1].name.namespaceURI, "");
      assert.equal(node.prefixDecls.size, 1);
      assert.equal(
        parent.children[1].name.namespaceURI,
        i === 0 ? "urn:outer" : `urn:scope${(i - 1) % 2}`,
      );
      parent = node;
    }
    expect(parent.children.map((n) => n.kind)).toEqual([
      "text",
      "cdata",
      "comment",
      "pi",
      "element",
    ]);
    expect(serializeXml(document)).toBe(source);
  });

  it("preserves default namespace shadowing and empty-element scope restoration", () => {
    const depth = 15000;
    const source = `<?xml version="1.0"?><root xmlns="urn:outer">${'<n xmlns="urn:inner"><empty xmlns=""/>'.repeat(depth)}<leaf/>${"</n><sibling/>".repeat(depth)}</root>`;
    const document = parseXml(source);
    let parent = document.root;
    for (let i = 0; i < depth; i++) {
      const node = parent.children[i === 0 ? 0 : 1];
      assert.equal(node.name.namespaceURI, "urn:inner");
      assert.equal(node.children[0].name.namespaceURI, "");
      assert.equal(
        parent.children[i === 0 ? 1 : 2].name.namespaceURI,
        i === 0 ? "urn:outer" : "urn:inner",
      );
      parent = node;
    }
    expect(serializeXml(document)).toBe(source);
  });

  it("repairs namespaces of authored deep trees while restoring siblings' bindings", () => {
    const depth = 12000,
      document = parseXml('<r xmlns:p="urn:original"/>');
    let parent = document.root;
    for (let i = 0; i < depth; i++) {
      const child = elem(qname("p", "node", "urn:inserted"));
      parent.children.push(child, elem(qname("p", "sibling", "urn:original")));
      parent = child;
    }
    const output = serializeXml(document),
      read = parseXml(output);
    parent = read.root;
    for (let i = 0; i < depth; i++) {
      assert.equal(parent.children[1].name.namespaceURI, "urn:original");
      parent = parent.children[0];
      assert.equal(parent.name.namespaceURI, "urn:inserted");
    }
    expect(document.root.prefixDecls).toEqual(new Map([["p", "urn:original"]]));
    expect(output.match(/xmlns:ns1="urn:inserted"/g)).toHaveLength(1);
    expect(serializeXml(read)).toBe(output);
  });

  it.each([
    ["mismatch", "<wrong></other>", /mismatched closing tag/],
    ["missing close", "<unfinished>", /unterminated element <unfinished>/],
    ["unbound prefix", "<missing:node/>", /unbound namespace prefix/],
  ])(
    "reports a deep %s as an XML parse error, not a stack overflow",
    (_, tail, message) => {
      const source = "<root>" + "<n>".repeat(18000) + tail;
      expect(() => parseXml(source)).toThrow(XmlParseError);
      expect(() => parseXml(source)).toThrow(message);
    },
  );

  it("keeps namespace caches separate from source declarations and later documents", () => {
    const first = parseXml(
      '<a:r xmlns:a="urn:one"><b:n xmlns:b="urn:two"><a:n/><a:n/></b:n></a:r>',
    );
    expect(first.root.children[0].prefixDecls).toEqual(
      new Map([["b", "urn:two"]]),
    );
    expect(first.root.children[0].children[0].prefixDecls.size).toBe(0);
    expect(() => parseXml("<a:r/>")).toThrow(/unbound namespace prefix/);
    expect(parseXml("<r/>").root.name.namespaceURI).toBe("");
    expect(parseXml('<a:r xmlns:a="urn:new"/>').root.name.namespaceURI).toBe(
      "urn:new",
    );
  });

  it("rejects cyclic authored trees while allowing shared subtrees in separate branches", () => {
    const document = parseXml("<root><child/></root>");
    document.root.children[0].children.push(document.root);
    expect(() => serializeXml(document)).toThrow(/Cyclic XML element tree/);
    document.root.children[0].children = [];
    const shared = document.root.children[0];
    document.root.children.push(shared);
    expect(serializeXml(document)).toContain("<root><child/><child/></root>");
  });
});
