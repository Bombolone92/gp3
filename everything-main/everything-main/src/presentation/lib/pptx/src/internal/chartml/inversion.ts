import {
  NS,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";

// MS-ODRAWXML 2.7.1.1 / 2.7.3.3. Identify the extension by both its
// registered URI and its expanded names; XML prefixes are arbitrary.
export const INVERT_SOLID_FILL_URI = "{6F2FDCE9-48DA-4B69-8628-5D25D57E5C99}";
export const INVERT_SOLID_FILL_NS =
  "http://schemas.microsoft.com/office/drawing/2007/8/2/chart";
export const invertedSolidFillRecord = (
  series: XmlElement,
): XmlElement | null => {
  const list = firstChildElement(series, qname("c", "extLst", NS.chart));
  return list
    ? (allChildElements(list, qname("c", "ext", NS.chart)).find(
        (record) =>
          getAttrValue(record, qname("", "uri", "")) === INVERT_SOLID_FILL_URI,
      ) ?? null)
    : null;
};
export const invertedSolidFillHost = (
  series: XmlElement,
): XmlElement | null => {
  const record = invertedSolidFillRecord(series);
  const format =
    record &&
    firstChildElement(
      record,
      qname("c14", "invertSolidFillFmt", INVERT_SOLID_FILL_NS),
    );
  return (
    format &&
    firstChildElement(format, qname("c14", "spPr", INVERT_SOLID_FILL_NS))
  );
};
