import { NS, type XmlElement, getAttrValue, qname } from "../xml/index.ts";

/** Native paragraph bullet choice. A start value belongs to the numbering
 * sequence; repeating it on subsequent paragraphs does not restart each item. */
export type BulletStyle =
  | "bullet"
  | "number"
  | "none"
  | { char: string }
  | { autoNum: string; startAt?: number };

/** Read one qualified DrawingML bullet choice without changing source XML. */
export const readDrawingBullet = (element: XmlElement): BulletStyle | null => {
  if (element.name.namespaceURI !== NS.dml) return null;
  const value = (name: string) => getAttrValue(element, qname("", name, ""));
  switch (element.name.localName) {
    case "buNone":
      return "none";
    case "buChar": {
      const char = value("char");
      return char === "•" ? "bullet" : char === null ? null : { char };
    }
    case "buAutoNum": {
      const type = value("type");
      if (type === null) return null;
      const raw = value("startAt");
      const n = raw === null ? 1 : Number(raw);
      // ST_TextBulletStartAtNum is an integer in [1,32767], default 1.
      // Invalid metadata remains untouched; readers use the schema default.
      const start =
        (raw === null || /^\+?\d+$/.test(raw.trim())) &&
        Number.isInteger(n) &&
        n >= 1 &&
        n <= 32767
          ? n
          : 1;
      if (type === "arabicPeriod" && start === 1) return "number";
      return { autoNum: type, ...(start === 1 ? {} : { startAt: start }) };
    }
    default:
      return null;
  }
};
