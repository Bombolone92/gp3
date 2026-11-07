import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  P,
  createDeck,
  parseDeck,
  preview,
  textRuns,
  displayShapeText,
  slideDescription,
  setRichText,
  History,
  tableText,
} from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { slideFieldStamp } from "../src/slide-fields.js";
import { createDateDeck } from "./date-field-fixture.js";
const fixed = new Date("2024-02-29T00:05:06Z");
const at = (type, language = "en-US", date = fixed, options = {}) =>
  P.formatDateTimeField(
    type,
    date,
    { language },
    { timeZone: "UTC", ...options },
  );
const plain = (s) => s.replace(/<[^>]*>/g, "");
const local = () => new Date(2024, 1, 29, 0, 5, 6);
afterEach(() => vi.useRealTimers());

describe("automatic date field pictures", () => {
  it("implements every numbered English format and the default aliases", () => {
    const expected = [
      "2/29/24",
      "Thursday, February 29, 2024",
      "29 February 2024",
      "February 29, 2024",
      "29-Feb-24",
      "February 24",
      "Feb-24",
      "2/29/24 12:05 AM",
      "2/29/24 12:05:06 AM",
      "00:05",
      "00:05:06",
      "12:05 AM",
      "12:05:06 AM",
    ];
    expect(expected.map((_, i) => at(`datetime${i + 1}`))).toEqual(expected);
    expect(at("datetime")).toBe(expected[0]);
    expect(at("datetimeFigureOut")).toBe(expected[0]);
    for (let i = 1; i <= 7; i++)
      expect(at(`uaqdatetime${i}`)).toBe(expected[i - 1]);
    expect(at("datetime5", "en-US", new Date("2000-01-01T12:00:00Z"))).toBe(
      "1-Jan-00",
    );
    expect(at("datetime12", "en-US", new Date("2000-01-01T12:00:00Z"))).toBe(
      "12:00 PM",
    );
  });
  it("uses locale-dependent format IDs, grammatical month forms and literal words", () => {
    expect(at("datetime3", "en-GB")).toBe("29 February, 2024");
    expect(at("datetime5", "de-DE")).toBe("24-02-29");
    expect(at("datetime4", "ru-RU")).toContain("29 февраля 2024");
    expect(at("datetime2", "sv-SE")).toBe("torsdag den 29 februari 2024");
    expect(at("datetime6", "es-ES")).toBe("febrero de 2024");
    expect(at("datetime5", "da-DK")).toBe("februar 2024");
    expect(at("datetime7", "nb-NO")).toContain("29. feb.");
  });
  it("supports Japanese eras and Chinese numeral pictures without rewriting the language", () => {
    const date = new Date("2026-09-17T12:00:00Z");
    expect(at("datetime3", "ja-JP", date)).toBe("令和8年9月17日");
    expect(at("datetime7", "ja-JP", date)).toBe("令和八年九月十七日");
    expect(at("datetime6", "zh-TW", date)).toBe("二〇二六年九月十七日星期四");
    expect(at("datetime3", "ko-KR", date)).toBe("단기 4359년 9월 17일");
    // The documented Japanese format1 is Gregorian, although some native
    // writers rewrite its language to en-US. Keep the authored language.
    expect(at("datetime1", "ja-JP", date)).toBe("2026/9/17");
  });
  it("distinguishes tabular Hijri, Umm al-Qura, Hebrew, Buddhist and Saka dates", () => {
    const date = new Date("2026-09-17T12:00:00Z");
    expect(at("datetime5", "ar-SA", date)).toBe("1448-04-05");
    expect(at("uaqdatetime5", "ar-SA", date)).toBe("1448-04-06");
    expect(at("datetime9", "ar-SA", date)).toContain("2026");
    expect(at("datetime3", "hi-IN")).toBe("१०/१२/१९४५");
    expect(at("datetime8", "th-TH")).toBe("๒๙/๐๒/๖๗");
    expect(at("datetime2", "th-TH")).toBe(
      "วันพฤหัสบดีที่ 29 กุมภาพันธ์ พ.ศ. 2567",
    );
    expect(at("datetime3", "he-IL", new Date("2023-09-16T12:00:00Z"))).toBe(
      "א' בתשרי תשפ\"ד",
    );
  });
  it("applies time zones, midnight and daylight-saving boundaries to all components together", () => {
    expect(
      at("datetime9", "en-US", new Date("2024-03-10T09:59:59Z"), {
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("3/10/24 1:59:59 AM");
    expect(
      at("datetime9", "en-US", new Date("2024-03-10T10:00:00Z"), {
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("3/10/24 3:00:00 AM");
    expect(
      at("datetime9", "en-US", fixed, { timeZone: "America/Los_Angeles" }),
    ).toBe("2/28/24 4:05:06 PM");
  });
  it("preserves unknown types and tolerates unknown language metadata", () => {
    for (const type of [
      null,
      "vendor-date",
      "DateTime1",
      "datetime0",
      "datetime14",
      "datetime01",
      "uaqdatetime8",
    ]) {
      expect(at(type)).toBeNull();
      expect(
        P.evaluateTextField(type, "Authored value", {}, { date: fixed }),
      ).toBe("Authored value");
    }
    expect(
      P.formatDateTimeField(
        "datetime5",
        fixed,
        { language: "bad_tag!", alternateLanguage: "de-DE" },
        { timeZone: "UTC" },
      ),
    ).toBe("24-02-29");
    expect(
      P.formatDateTimeField(
        "datetime5",
        fixed,
        { language: "zz-ZZ" },
        { locale: "en-US", timeZone: "UTC" },
      ),
    ).toBe("29-Feb-24");
    expect(() => at("datetime1", "en-US", new Date(NaN))).toThrow(RangeError);
    expect(() =>
      at("datetime1", "en-US", fixed, { timeZone: "bad_zone" }),
    ).toThrow(RangeError);
  });
  it.each([
    "en-US",
    "en-GB",
    "de-DE",
    "fr-FR",
    "ja-JP",
    "zh-CN",
    "zh-TW",
    "ko-KR",
    "ar-SA",
    "ar-EG",
    "he-IL",
    "fa-IR",
    "th-TH",
    "hi-IN",
    "vi-VN",
    "syr-SY",
    "sv-SE",
    "da-DK",
    "nb-NO",
    "fi-FI",
    "nl-NL",
    "it-IT",
    "hu-HU",
    "es-ES",
  ])("formats all choices in %s over year and calendar boundaries", (lang) => {
    for (const date of [
      fixed,
      new Date("2026-09-17T23:59:59Z"),
      new Date("2000-01-01T12:00:00Z"),
    ]) {
      for (let i = 1; i <= 13; i++) {
        const value = at(`datetime${i}`, lang, date);
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(/NaN|undefined|Invalid Date|CACHED/);
        if (lang !== "he-IL") expect(value).not.toContain('"');
      }
    }
  });
});

describe("date field display lifecycle", () => {
  it.each(["slide", "layout", "master"])(
    "evaluates %s fields in both rendering modes without changing source parts",
    async (owner) => {
      const p = await parseDeck(await createDateDeck({ owner }));
      P.refreshPresentationFields(p, local());
      const before = unzipSync(await P.savePresentation(p));
      for (const s of P.getSlides(p))
        for (const textLayout of ["svg", "foreignObject"])
          expect(plain(renderSlideToSvg(p, s, { textLayout }))).toContain(
            "Date: 2/29/24 / literal 999",
          );
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      const s = P.getSlides(p)[0],
        stamp = slideFieldStamp(p, s);
      P.refreshPresentationFields(p, new Date(2030, 0, 1));
      expect(slideFieldStamp(p, s)).not.toBe(stamp);
      expect(plain(decodeURIComponent(preview(p, s)))).toContain(
        "Date: 1/1/30",
      );
      const date = P.getPresentationFieldDate(p);
      date.setFullYear(1900);
      expect(P.getPresentationFieldDate(p).getFullYear()).toBe(2030);
    },
  );
  it("shares inherited language with groups, table cells, editing and accessible text", async () => {
    const p = await parseDeck(
      await createDateDeck({
        type: "datetime5",
        language: "de-DE",
        inherited: true,
      }),
    );
    P.refreshPresentationFields(p, local());
    const s = P.getSlides(p)[0],
      shape = P.getSlideShapes(s)[1];
    expect(displayShapeText(p, shape)).toBe("Date: 24-02-29 / literal 999");
    expect(textRuns(p, shape)[0].runs[1].text).toBe("24-02-29");
    expect(slideDescription(s, p)).toContain("24-02-29");
    P.groupShapes(P.getSlideShapes(s));
    expect(plain(decodeURIComponent(preview(p, s)))).toContain("24-02-29");
    const table = await parseDeck(
      await createDateDeck({
        type: "datetime5",
        language: "de-DE",
        inherited: true,
        table: true,
      }),
    );
    P.refreshPresentationFields(table, local());
    const ts = P.getSlides(table)[0];
    for (const mode of ["svg", "foreignObject"])
      expect(
        plain(renderSlideToSvg(table, ts, { textLayout: mode })),
      ).toContain("24-02-29");
    expect(tableText(P.getSlideTables(ts)[0], table)).toContain("24-02-29");
  });
  it("keeps untouched fields live through adjacent edits, copying and two imports", async () => {
    const p = await parseDeck(await createDateDeck()),
      s = P.getSlides(p)[0],
      shape = P.getSlideShapes(s)[1];
    P.refreshPresentationFields(p, local());
    const before = P.getShapeXmlString(shape),
      runs = textRuns(p, shape);
    expect(P.getShapeXmlString(shape)).toBe(before);
    runs[0].runs[0].text = "Edited date: ";
    setRichText(shape, runs);
    const copied = P.copyShape(P.getSlides(p)[1], shape);
    expect(P.getShapeXmlString(copied)).toContain('type="datetime1"');
    const clip = createDeck(),
      dest = createDeck();
    const imported = P.importSlide(clip, s, P.getSlideLayouts(clip)[0]);
    P.importSlide(dest, imported, P.getSlideLayouts(dest)[0]);
    const loaded = await parseDeck(await P.savePresentation(dest));
    P.refreshPresentationFields(loaded, new Date(2030, 0, 1));
    const pasted = P.getSlideShapes(P.getSlides(loaded)[1])[1];
    expect(displayShapeText(loaded, pasted)).toBe(
      "Edited date: 1/1/30 / literal 999",
    );
    expect(P.getShapeXmlString(pasted)).toContain('type="datetime1"');
    const edited = textRuns(loaded, pasted);
    edited[0].runs[1].text = "Fixed text";
    setRichText(pasted, edited);
    expect(P.getShapeXmlString(pasted)).not.toContain('type="datetime1"');
    expect(displayShapeText(loaded, pasted)).toContain("Fixed text");
  });
  it("holds the opening snapshot through clock changes and undo, but updates when reopened", async () => {
    const bytes = await createDateDeck();
    vi.useFakeTimers();
    vi.setSystemTime(local());
    const p = await parseDeck(bytes),
      h = new History();
    await h.reset(p);
    const s = P.getSlides(p)[0],
      shape = P.getSlideShapes(s)[0];
    P.setShapeText(shape, "Changed");
    await h.capture(p);
    vi.setSystemTime(new Date(2030, 0, 1));
    expect(P.getPresentationFieldDate(p)).toEqual(local());
    const undone = await h.undo();
    expect(P.getPresentationFieldDate(undone)).toEqual(local());
    const redone = await h.redo();
    expect(P.getPresentationFieldDate(redone)).toEqual(local());
    const opened = await parseDeck(await P.savePresentation(p));
    expect(P.getPresentationFieldDate(opened).getFullYear()).toBe(2030);
    P.refreshPresentationFields(redone);
    P.setShapeText(P.getSlideShapes(P.getSlides(redone)[0])[0], "Second edit");
    await h.capture(redone);
    expect(P.getPresentationFieldDate(await h.undo()).getFullYear()).toBe(2030);
  });
  it("detects aliased and encoded fields but excludes unused template placeholders and unknown types", async () => {
    const files = unzipSync(await createDateDeck());
    files["ppt/slides/slide1.xml"] = strToU8(
      strFromU8(files["ppt/slides/slide1.xml"])
        .replaceAll("a:fld", "field:fld")
        .replace(
          "<p:sld ",
          '<p:sld xmlns:field="http://schemas.openxmlformats.org/drawingml/2006/main" ',
        )
        .replace('type="datetime1"', 'type="date&#116;ime1"'),
    );
    const p = await parseDeck(zipSync(files));
    P.refreshPresentationFields(p, local());
    expect(slideFieldStamp(p, P.getSlides(p)[0])).toContain(
      String(local().getTime()),
    );
    expect(plain(decodeURIComponent(preview(p, P.getSlides(p)[0])))).toContain(
      "2/29/24",
    );
    const unknown = await parseDeck(
      await createDateDeck({ type: "vendor-date" }),
    );
    expect(slideFieldStamp(unknown, P.getSlides(unknown)[0])).toBeNull();
    expect(
      plain(decodeURIComponent(preview(unknown, P.getSlides(unknown)[0]))),
    ).toContain("CACHED-DATE");
    const empty = createDeck();
    expect(slideFieldStamp(empty, P.getSlides(empty)[0])).toBeNull();
  });
  it("uses an explicit rendering clock and zone without changing the presentation snapshot", async () => {
    const p = await parseDeck(await createDateDeck({ type: "datetime9" }));
    P.refreshPresentationFields(p, local());
    const before = P.getPresentationFieldDate(p);
    const rendered = renderSlideToSvg(p, P.getSlides(p)[0], {
      textLayout: "svg",
      fieldDate: new Date("2030-01-01T00:05:06Z"),
      // A zone fixed at UTC-8: Vancouver's winter offset changed in tzdata 2026c.
      dateFieldOptions: { timeZone: "Pacific/Pitcairn" },
    });
    expect(plain(rendered)).toContain("12/31/29 4:05:06 PM");
    expect(P.getPresentationFieldDate(p)).toEqual(before);
  });
  it("ignores dates in unused layout placeholders", async () => {
    const files = unzipSync(await createDateDeck({ owner: "layout" }));
    for (const name of Object.keys(files)) {
      if (!name.startsWith("ppt/slideLayouts/") || !name.endsWith(".xml"))
        continue;
      files[name] = strToU8(
        strFromU8(files[name]).replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) =>
          shape.includes("CACHED-DATE")
            ? shape.replace(
                "<p:nvPr/>",
                '<p:nvPr><p:ph type="dt" idx="10"/></p:nvPr>',
              )
            : shape,
        ),
      );
    }
    const p = await parseDeck(zipSync(files));
    for (const s of P.getSlides(p)) {
      expect(slideFieldStamp(p, s)).toBeNull();
      expect(
        plain(renderSlideToSvg(p, s, { textLayout: "svg" })),
      ).not.toContain("Date:");
    }
  });
});
