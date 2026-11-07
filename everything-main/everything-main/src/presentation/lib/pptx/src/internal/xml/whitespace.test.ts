import { describe, expect, it } from "vitest";
import {
  XmlParseError,
  attr,
  cdata,
  elem,
  parseFragment,
  parseXml,
  qname,
  serializeFragment,
  text,
  textContent,
} from "./index.ts";

// XML 1.0 §§2.11 and 3.3.3 distinguish physical line endings from
// whitespace supplied by character references, including under xml:space.
describe("XML physical whitespace normalization", () => {
  for (const [name, newline] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ]) {
    it(`${name} yields one LF in text, including preserved space`, () => {
      const e = parseFragment(
        `<r xml:space="preserve"> A${newline} B${newline}${newline}C </r>`,
      );
      expect(textContent(e)).toBe(" A\n B\n\nC ");
      expect(textContent(parseFragment(serializeFragment(e)))).toBe(
        " A\n B\n\nC ",
      );
    });

    it(`${name} normalizes CDATA without decoding references`, () => {
      const e = parseFragment(`<r><![CDATA[A${newline}B&#13;]]></r>`);
      expect(e.children).toEqual([cdata("A\nB&#13;")]);
    });

    it(`${name} normalizes comments and processing instructions throughout a document`, () => {
      const doc = parseXml(
        `<!-- A${newline}B --><?pre A${newline}B?><r><!-- C${newline}D --><?inside C${newline}D?></r><?post E${newline}F?><!-- E${newline}F -->`,
      );
      expect(doc.prolog.map((n) => n.data)).toEqual([" A\nB ", "A\nB"]);
      expect(doc.root.children.map((n) => "data" in n && n.data)).toEqual([
        " C\nD ",
        "C\nD",
      ]);
      expect(doc.epilog.map((n) => n.data)).toEqual(["E\nF", " E\nF "]);
    });

    for (const quote of ['"', "'"])
      it(`${name} literal attribute whitespace becomes spaces (${quote})`, () => {
        const e = parseFragment(
          `<r value=${quote} A${newline}\t B  ${quote}/>`,
        );
        expect(e.attrs[0]!.value).toBe(" A   B  ");
        expect(parseFragment(serializeFragment(e)).attrs).toEqual(e.attrs);
      });

    it(`${name} error locations count logical lines and retain source offsets`, () => {
      const src = `<r>${newline}<a/>${newline}</wrong>`;
      try {
        parseXml(src);
        throw new Error("expected parse error");
      } catch (error) {
        expect(error).toBeInstanceOf(XmlParseError);
        expect(error).toMatchObject({ offset: src.length, line: 3, column: 9 });
      }
    });
  }

  it("normalizes literal whitespace before decoding character references", () => {
    const e = parseFragment(
      '<r a="\r\n&#13;&#10;&#9;\r\t &amp;#13;">\r\n&#13;\n&#xD;&#xA;&#x9;&amp;#13;</r>',
    );
    expect(e.attrs[0]!.value).toBe(" \r\n\t   &#13;");
    expect(textContent(e)).toBe("\n\r\n\r\n\t&#13;");
    const restored = parseFragment(serializeFragment(e));
    expect(restored.attrs).toEqual(e.attrs);
    expect(textContent(restored)).toBe(textContent(e));
  });

  it("preserves XML 1.0 non-ASCII line separators and ordinary text tabs", () => {
    const value = "A\u0085B\u2028C\tD";
    const e = parseFragment(`<r v="${value}">${value}</r>`);
    expect(textContent(e)).toBe(value);
    expect(e.attrs[0]!.value).toBe("A\u0085B\u2028C D");
  });

  it("normalizes namespaced attribute values without changing their names", () => {
    const e = parseFragment('<r xmlns:e="urn:extension" e:v="A\r\nB\tC"/>');
    expect(e.attrs[0]!.value).toBe("A B C");
    expect(e.attrs[0]!.name.namespaceURI).toBe("urn:extension");
  });

  it.each(["\r", "\r\n", "A\rB\nC", "\r]]>\r\n&#13;\t"])(
    "preserves authored CR semantics when serializing text, attributes and CDATA: %j",
    (value) => {
      const e = elem(qname("", "r", ""), {
        attrs: [attr(qname("", "v", ""), value)],
        children: [text(value), cdata(value)],
      });
      const restored = parseFragment(serializeFragment(e));
      expect(restored.attrs[0]!.value).toBe(value);
      expect(textContent(restored)).toBe(value + value);
      expect(textContent(parseFragment(serializeFragment(restored)))).toBe(
        value + value,
      );
    },
  );
});
