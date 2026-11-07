import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-parameters-native.json";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramTextParagraphs } from "../lib/pptx/src/internal/diagram/text-content.ts";
import {
  readDiagramTextParameters,
  resolveDiagramTextFormatting,
} from "../lib/pptx/src/internal/diagram/text-parameters.ts";

const node = (parameters = "", type = "tx") => ({
  algorithm: parseXml(
    `<d:alg xmlns:d="${NS.diagram}" xmlns:x="urn:foreign" type="${type}">${parameters}</d:alg>`,
  ).root,
});
const param = (type, value) => `<d:param type="${type}" val="${value}"/>`;

describe("SmartArt text algorithm parameters", () => {
  it.each(native.cases)("matches native parameter behavior: $name", (row) => {
    const data = parseXml(native.models[row.model]),
      layout = parseXml(native.layouts[row.layout]),
      before = [serializeXml(data), serializeXml(layout)];
    const text = expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    ).children.find((n) => n.name === "text");
    if (row.expected === null) {
      // The native app substituted a different layout. Its fallback drawing
      // must never become expected successful output for the authored layout.
      expect(() => readDiagramTextParameters(text)).toThrow(
        "invalid diagram text parameter",
      );
    } else {
      const paragraphs = readDiagramTextParagraphs(text);
      const format = resolveDiagramTextFormatting(
        readDiagramTextParameters(text),
        paragraphs,
        false,
      );
      expect({
        body: {
          anchor: format.anchor,
          anchorCtr: format.anchorCenter ? "1" : "0",
          vert: format.vertical,
        },
        paragraphs: paragraphs.map((p) => format[p.font]),
      }).toEqual(row.expected);
    }
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });

  it("keeps host direction independent from semantic paragraph roles", () => {
    const parameters = readDiagramTextParameters(
      node(
        param("parTxLTRAlign", "l") +
          param("parTxRTLAlign", "r") +
          param("shpTxLTRAlignCh", "r") +
          param("shpTxRTLAlignCh", "ctr") +
          param("lnSpPar", 125) +
          param("lnSpCh", 85),
      ),
    );
    const primary = [{ font: "primary", level: 8, hierarchyLevel: 0 }];
    const mixed = [
      ...primary,
      { font: "secondary", level: 0, hierarchyLevel: 1 },
    ];
    expect(
      resolveDiagramTextFormatting(parameters, primary, false).primary,
    ).toEqual({ alignment: "l", lineSpacing: 125000, spaceAfter: 35000 });
    expect(
      resolveDiagramTextFormatting(parameters, primary, true).primary,
    ).toEqual({ alignment: "r", lineSpacing: 125000, spaceAfter: 35000 });
    const rtl = resolveDiagramTextFormatting(parameters, mixed, true);
    expect(rtl.primary).toEqual({
      alignment: "ctr",
      lineSpacing: 125000,
      spaceAfter: 35000,
    });
    expect(rtl.secondary).toEqual({
      alignment: "ctr",
      lineSpacing: 85000,
      spaceAfter: 15000,
    });
    expect(
      resolveDiagramTextFormatting(parameters, mixed, false).primary.alignment,
    ).toBe("r");
  });

  it("retains geometry parameters for the layout engine", () => {
    expect(readDiagramTextParameters(node())).toMatchObject({
      autoTxRot: "upr",
      txDir: "fromT",
      txBlDir: "horz",
      stBulletLvl: 2,
    });
    expect(
      readDiagramTextParameters(
        node(param("autoTxRot", "grav") + param("txDir", "fromB")),
      ),
    ).toMatchObject({ autoTxRot: "grav", txDir: "fromB" });
  });

  it("ignores foreign vocabulary and keeps independent parameter state", () => {
    const input = node(
      '<x:param type="lnSpPar" val="garbage"/>' + param("lnSpPar", 72),
    );
    const result = readDiagramTextParameters(input);
    expect(result.lnSpPar).toBe(72);
    result.lnSpPar = 50;
    expect(readDiagramTextParameters(input).lnSpPar).toBe(72);
    expect(readDiagramTextParameters(node()).lnSpPar).toBe(90);
  });

  it.each([
    [param("lnSpPar", 10) + param("lnSpPar", 20), "duplicate"],
    ['<d:param type="lnSpPar"/>', "invalid"],
    ['<d:param val="1"/>', "missing"],
    [param("autoTxRot", "sideways"), "invalid"],
    [param("txDir", "fromL"), "invalid"],
    [param("txAnchorHorzCh", "l"), "invalid"],
    [param("shpTxRTLAlignCh", "just"), "invalid"],
  ])("rejects ambiguous or malformed parameters %s", (xml, message) => {
    expect(() => readDiagramTextParameters(node(xml))).toThrow(message);
  });
  it("requires a text algorithm", () => {
    expect(() => readDiagramTextParameters(node("", "lin"))).toThrow(
      "require a text algorithm",
    );
    expect(() => readDiagramTextParameters({ algorithm: null })).toThrow(
      "require a text algorithm",
    );
  });
});
