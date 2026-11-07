import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-font-defaults-native.json";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramTextCustomization } from "../lib/pptx/src/internal/diagram/text-customization.ts";
import { evaluateDiagramInitialConstraints } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { projectDiagramTextBodyProperties } from "../lib/pptx/src/api/fn/diagram-text-body.ts";

// The saved geometry independently identifies the native primary font, since
// input h references primFontSz. Host styles are retained as provenance: these
// deliberately conflicting text defaults must not enter the TX constraint pass.
describe("SmartArt primary-font fallback", () => {
  it.each(native.cases)(
    "matches native font selection with host overrides: $name",
    (row) => {
      const data = parseXml(native.models[row.model]),
        layout = parseXml(native.layouts[row.layout]);
      const before = [serializeXml(data), serializeXml(layout)];
      const root = expandDiagramLayout(
        layout.root,
        readDiagramHierarchy(readDiagramDataModel(data.root)),
      );
      const text = root.children.find((n) => n.name === "text"),
        custom = readDiagramTextCustomization(text);
      const result = evaluateDiagramInitialConstraints(
        root,
        { w: 200, h: 100 },
        {
          quantizeFonts: true,
          changes: custom
            ? [
                {
                  owner: text,
                  property: {
                    type: "primFontSz",
                    selector: {
                      relationship: "self",
                      name: "",
                      pointType: "all",
                    },
                  },
                  value: custom.primaryFontSize,
                },
              ]
            : [],
        },
      ).get(text);
      const body = projectDiagramTextBodyProperties(
        text,
        {
          dataOwner: "/ppt/diagrams/data1.xml",
          margins: Object.fromEntries(
            ["l", "r", "t", "b"].map((s) => [s, result.values.get(`${s}Marg`)]),
          ),
        },
        new WeakMap(),
      );
      expect(Math.round(result.size.h * 36000)).toBe(row.expected.height);
      expect(Number(getAttrValue(body, qname("", "lIns", "")))).toBe(
        row.expected.leftInset,
      );
      expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
    },
  );

  it("retains the independently varied host defaults used in the native controls", () => {
    for (const host of native.hosts) {
      expect(
        host.map((xml) => {
          const sizes = new Set();
          walkElements(parseXml(xml).root, (el) => {
            if (
              el.name.namespaceURI !== NS.dml ||
              el.name.localName !== "defRPr"
            )
              return;
            sizes.add(getAttrValue(el, qname("", "sz", "")));
          });
          return [...sizes];
        }),
      ).toEqual([["5400"], ["4500"], ["5700"]]);
    }
    expect(new Set(native.cases.map((c) => c.fontReference))).toEqual(
      new Set(["major", "minor", "none"]),
    );
  });
});
