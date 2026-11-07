// Edit the existing SpreadsheetML package, retaining unrelated part bodies.
// No spreadsheet evaluator is involved: formula-backed targets are relocated
// instead of replacing formulas or publishing stale formula-result caches.
import {
  NS,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
  attr,
  elem,
  text,
  qname,
  parseXml,
  serializeXml,
  firstChildElement,
  allChildElements,
  getAttrValue,
  walkElements,
  withInheritedNamespaces,
} from "../xml/index.ts";
import {
  type PartName,
  type ZipEntry,
  readZip,
  writeZip,
  partName,
  resolveTarget,
  relsPartNameFor,
  dirname,
  nextRelId,
} from "../opc/index.ts";
import { buildEmbeddedXlsx } from "./embedded-xlsx.ts";
import { chartCacheText } from "./chart-cache.ts";
import { readChartUnsignedInt } from "./axis-context.ts";
import {
  cellAddress,
  cellName,
  type WorkbookCellAddress,
  type WorkbookRange,
  XLSX_MAX_ROWS,
  XLSX_MAX_COLUMNS,
  workbookRange,
} from "./workbook-reference.ts";
const encoder = new TextEncoder(),
  decoder = new TextDecoder(),
  strictSml = "http://purl.oclc.org/ooxml/spreadsheetml/main",
  strictRels = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const a = (name: string) => qname("", name, "");
const value = (e: XmlElement, name: string) => getAttrValue(e, a(name));
const set = (e: XmlElement, name: string, v: string | null) => {
  e.attrs = e.attrs.filter(
    (x) => x.name.namespaceURI !== "" || x.name.localName !== name,
  );
  if (v !== null) e.attrs.push(attr(a(name), v));
};
const children = (e: XmlElement, name: string) =>
  allChildElements(e, qname(e.name.prefix, name, e.name.namespaceURI));
const child = (e: XmlElement, name: string) =>
  firstChildElement(e, qname(e.name.prefix, name, e.name.namespaceURI));
const node = (
  parent: XmlElement,
  name: string,
  attrs: Record<string, string> = {},
  body: XmlNode[] = [],
) =>
  elem(qname(parent.name.prefix, name, parent.name.namespaceURI), {
    attrs: Object.entries(attrs).map(([k, v]) => attr(a(k), v)),
    children: body,
  });
const sameNode = (n: XmlNode, ns: string, names: ReadonlyArray<string>) =>
  n.kind === "element" &&
  n.name.namespaceURI === ns &&
  names.includes(n.name.localName);
export class UneditableWorkbookRange extends Error {}
interface SheetInfo {
  readonly name: string;
  readonly part: PartName;
  readonly element: XmlElement;
  readonly worksheet: boolean;
}
interface Sheet extends SheetInfo {
  rowsExplicit: boolean;
  readonly implicitCellRows: Set<number>;
  readonly doc: XmlDocument;
  readonly rows: Map<number, XmlElement>;
  readonly cells: Map<string, XmlElement>;
  readonly formulaRanges: ReadonlyArray<{
    start: WorkbookCellAddress;
    end: WorkbookCellAddress;
  }>;
}
export interface WorkbookWrite {
  readonly sheet: string;
  readonly address: WorkbookCellAddress;
  readonly value?: string | number | null;
  readonly numberFormat?: string;
  readonly prototype?: XmlElement;
}
export class NativeChartWorkbook {
  readonly entries: ZipEntry[];
  readonly docs = new Map<string, XmlDocument>();
  readonly dirty = new Set<string>();
  readonly workbook: XmlDocument;
  readonly owner: PartName;
  readonly ns: string;
  readonly relNamespace: string;
  readonly sheets: SheetInfo[] = [];
  private readonly loadedSheets = new Map<string, Sheet>();
  private readonly tableCache = new Map<
    string,
    Array<{
      part: PartName;
      doc: XmlDocument;
      start: WorkbookCellAddress;
      end: WorkbookCellAddress;
    }>
  >();
  private readonly styleCache = new Map<string, number>();
  private stylesPart: PartName | null = null;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.entries = readZip(bytes).entries;
    const root = this.xml(partName("/_rels/.rels"));
    if (
      root.root.name.namespaceURI !== NS.relationships ||
      root.root.name.localName !== "Relationships"
    )
      throw new Error("invalid workbook root relationships");
    const office = children(root.root, "Relationship").find(
      (r) =>
        [
          NS.officeDocRels + "/officeDocument",
          strictRels + "/officeDocument",
        ].includes(value(r, "Type") ?? "") &&
        value(r, "TargetMode") !== "External",
    );
    if (!office) throw new Error("workbook main part is not bound");
    this.owner = resolveTarget("/", value(office, "Target") ?? "");
    this.workbook = this.xml(this.owner);
    this.ns = this.workbook.root.name.namespaceURI;
    if (
      ![NS.sml, strictSml].includes(this.ns) ||
      this.workbook.root.name.localName !== "workbook"
    )
      throw new Error("invalid workbook main part");
    this.relNamespace = this.ns === strictSml ? strictRels : NS.officeDocRels;
    const list = child(this.workbook.root, "sheets");
    if (!list) throw new Error("workbook sheets missing");
    for (const el of children(list, "sheet")) {
      const name = value(el, "name"),
        id =
          getAttrValue(el, qname("r", "id", this.relNamespace)) ??
          getAttrValue(el, qname("r", "id", NS.officeDocRels));
      const rel = this.rels(this.owner).find(
        (r) => value(r, "Id") === id && value(r, "TargetMode") !== "External",
      );
      if (
        !name ||
        !rel ||
        this.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())
      )
        throw new Error("invalid worksheet binding");
      const part = resolveTarget(this.owner, value(rel, "Target") ?? "");
      this.sheets.push({
        name,
        part,
        element: el,
        worksheet: [
          NS.officeDocRels + "/worksheet",
          strictRels + "/worksheet",
        ].includes(value(rel, "Type") ?? ""),
      });
    }
  }
  private entry(name: PartName): ZipEntry | null {
    return (
      this.entries.find(
        (e) => e.name.toLowerCase() === name.slice(1).toLowerCase(),
      ) ?? null
    );
  }
  xml(name: PartName): XmlDocument {
    const key = name.toLowerCase(),
      cached = this.docs.get(key);
    if (cached) return cached;
    const entry = this.entry(name);
    if (!entry) throw new Error(`workbook part missing: ${name}`);
    const doc = parseXml(decoder.decode(entry.data));
    this.docs.set(key, doc);
    return doc;
  }
  mark(name: PartName) {
    this.dirty.add(name.toLowerCase());
  }
  rels(owner: PartName): XmlElement[] {
    const name = relsPartNameFor(owner);
    if (!this.entry(name)) return [];
    const doc = this.xml(name);
    if (
      doc.root.name.namespaceURI !== NS.relationships ||
      doc.root.name.localName !== "Relationships"
    )
      throw new Error("invalid workbook relationships");
    return children(doc.root, "Relationship");
  }
  private addRelationship(
    owner: PartName,
    type: string,
    target: PartName,
  ): string {
    const name = relsPartNameFor(owner);
    let doc: XmlDocument;
    if (this.entry(name)) doc = this.xml(name);
    else {
      doc = parseXml(`<Relationships xmlns="${NS.relationships}"/>`);
      this.entries.push({
        name: name.slice(1),
        data: encoder.encode(serializeXml(doc)),
      });
      this.docs.set(name.toLowerCase(), doc);
    }
    const id = nextRelId(
      children(doc.root, "Relationship").map((r) => value(r, "Id") ?? ""),
    );
    doc.root.children.push(
      node(doc.root, "Relationship", { Id: id, Type: type, Target: target }),
    );
    this.mark(name);
    return id;
  }
  private addPart(name: PartName, type: string, doc: XmlDocument) {
    if (this.entry(name)) throw new Error("workbook part collision");
    this.entries.push({
      name: name.slice(1),
      data: encoder.encode(serializeXml(doc)),
    });
    this.docs.set(name.toLowerCase(), doc);
    this.mark(name);
    const types = this.xml(partName("/[Content_Types].xml"));
    if (
      types.root.name.namespaceURI !== NS.contentTypes ||
      types.root.name.localName !== "Types"
    )
      throw new Error("invalid workbook content types");
    types.root.children.push(
      node(types.root, "Override", { PartName: name, ContentType: type }),
    );
    this.mark(partName("/[Content_Types].xml"));
  }
  private freePart(base: string, suffix: string): PartName {
    let i = 1;
    while (this.entry(partName(`${base}${i}${suffix}`))) i++;
    return partName(`${base}${i}${suffix}`);
  }
  sheet(name: string): Sheet {
    const info = this.sheets.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (!info || !info.worksheet)
      throw new UneditableWorkbookRange("source is not a worksheet");
    const cached = this.loadedSheets.get(info.part);
    if (cached) return cached;
    const doc = this.xml(info.part);
    if (
      ![NS.sml, strictSml].includes(doc.root.name.namespaceURI) ||
      doc.root.name.localName !== "worksheet"
    )
      throw new UneditableWorkbookRange("invalid worksheet part");
    const rows = new Map<number, XmlElement>(),
      implicitCellRows = new Set<number>(),
      cells = new Map<string, XmlElement>(),
      formulaRanges: Array<{
        start: WorkbookCellAddress;
        end: WorkbookCellAddress;
      }> = [],
      data = child(doc.root, "sheetData");
    if (!data) throw new UneditableWorkbookRange("worksheet data missing");
    let previous = -1;
    for (const row of children(data, "row")) {
      const raw = value(row, "r"),
        index = raw === null ? previous + 1 : Number(raw) - 1;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= XLSX_MAX_ROWS ||
        rows.has(index)
      )
        throw new UneditableWorkbookRange("ambiguous worksheet rows");
      rows.set(index, row);
      previous = index;
      let prevCol = -1;
      for (const cell of children(row, "c")) {
        const raw = value(cell, "r"),
          address =
            raw === null ? { row: index, col: prevCol + 1 } : cellAddress(raw);
        if (
          !address ||
          address.row !== index ||
          address.col >= XLSX_MAX_COLUMNS ||
          cells.has(cellName(address))
        )
          throw new UneditableWorkbookRange("ambiguous worksheet cells");
        if (raw === null) implicitCellRows.add(index);
        prevCol = address.col;
        cells.set(cellName(address), cell);
        const f = child(cell, "f"),
          r = f && value(f, "ref")?.split(":"),
          start = r && cellAddress(r[0] ?? null),
          end = r && cellAddress(r[1] ?? r[0] ?? null);
        if (start && end) formulaRanges.push({ start, end });
      }
    }
    const sheet = {
      ...info,
      doc,
      rows,
      cells,
      formulaRanges,
      implicitCellRows,
      rowsExplicit: [...rows.values()].every((r) => value(r, "r") !== null),
    };
    this.loadedSheets.set(info.part, sheet);
    return sheet;
  }
  sourceRange(formula: string): WorkbookRange | null {
    const direct = workbookRange(formula);
    if (direct) return direct;
    const token = formula.replace(/^=/, ""),
      scoped = token.match(/^('(?:[^']|'')+'|[^!]+)!(.+)$/),
      sheet = scoped
        ? scoped[1]!.startsWith("'")
          ? scoped[1]!.slice(1, -1).replace(/''/g, "'")
          : scoped[1]!
        : null,
      name = scoped?.[2] ?? token,
      scope =
        sheet === null
          ? null
          : this.sheets.findIndex(
              (s) => s.name.toLowerCase() === sheet.toLowerCase(),
            ),
      names = child(this.workbook.root, "definedNames");
    if (!names || scope === -1) return null;
    const matches = children(names, "definedName").filter(
      (n) =>
        value(n, "name")?.toLowerCase() === name.toLowerCase() &&
        (scope === null
          ? value(n, "localSheetId") === null
          : value(n, "localSheetId") === String(scope)),
    );
    return matches.length === 1
      ? workbookRange(chartCacheText(matches[0]!))
      : null;
  }
  cell(sheet: string, address: WorkbookCellAddress): XmlElement | null {
    return this.sheet(sheet).cells.get(cellName(address)) ?? null;
  }
  private tables(sheet: Sheet): Array<{
    part: PartName;
    doc: XmlDocument;
    start: WorkbookCellAddress;
    end: WorkbookCellAddress;
  }> {
    const cached = this.tableCache.get(sheet.part);
    if (cached) return cached;
    const refs = child(sheet.doc.root, "tableParts");
    if (!refs) return [];
    const tables = children(refs, "tablePart").map((ref) => {
      const id =
        getAttrValue(ref, qname("r", "id", this.relNamespace)) ??
        getAttrValue(ref, qname("r", "id", NS.officeDocRels));
      const rel = this.rels(sheet.part).find(
        (r) =>
          value(r, "Id") === id &&
          [NS.officeDocRels + "/table", strictRels + "/table"].includes(
            value(r, "Type") ?? "",
          ) &&
          value(r, "TargetMode") !== "External",
      );
      if (!rel) throw new UneditableWorkbookRange("table binding missing");
      const part = resolveTarget(sheet.part, value(rel, "Target") ?? ""),
        doc = this.xml(part),
        range = value(doc.root, "ref")?.split(":"),
        start = cellAddress(range?.[0] ?? null),
        end = cellAddress(range?.[1] ?? range?.[0] ?? null);
      if (!start || !end || doc.root.name.localName !== "table")
        throw new UneditableWorkbookRange("table range invalid");
      return { part, doc, start, end };
    });
    this.tableCache.set(sheet.part, tables);
    return tables;
  }
  canWrite(write: WorkbookWrite): boolean {
    const sheet = this.sheet(write.sheet),
      cell = this.cell(write.sheet, write.address);
    if (
      write.value !== undefined &&
      cell &&
      (child(cell, "f") ||
        value(cell, "cm") !== null ||
        value(cell, "vm") !== null)
    )
      return false;
    const merges = child(sheet.doc.root, "mergeCells");
    for (const merge of merges ? children(merges, "mergeCell") : []) {
      const r = value(merge, "ref")?.split(":"),
        lo = cellAddress(r?.[0] ?? null),
        hi = cellAddress(r?.[1] ?? null);
      if (
        lo &&
        hi &&
        write.address.row >= lo.row &&
        write.address.row <= hi.row &&
        write.address.col >= lo.col &&
        write.address.col <= hi.col
      )
        return false;
    }
    // Array/data-table formula ranges may include cells without their own f.
    for (const { start: lo, end: hi } of write.value === undefined
      ? []
      : sheet.formulaRanges)
      if (
        write.address.row >= lo.row &&
        write.address.row <= hi.row &&
        write.address.col >= lo.col &&
        write.address.col <= hi.col
      )
        return false;
    for (const table of this.tables(sheet))
      if (
        write.value !== undefined &&
        write.address.row >= table.start.row &&
        write.address.row <= table.end.row &&
        write.address.col >= table.start.col &&
        write.address.col <= table.end.col &&
        ["queryTable", "xml"].includes(value(table.doc.root, "tableType") ?? "")
      )
        return false;
    for (const table of this.tables(sheet))
      if (
        write.value !== undefined &&
        write.address.row === table.start.row &&
        write.address.col >= table.start.col &&
        write.address.col <= table.end.col &&
        value(table.doc.root, "headerRowCount") !== "0"
      ) {
        if (
          typeof write.value !== "string" ||
          write.value === "" ||
          (value(table.doc.root, "tableType") &&
            value(table.doc.root, "tableType") !== "worksheet")
        )
          return false;
        const cols = child(table.doc.root, "tableColumns"),
          column =
            cols &&
            children(cols, "tableColumn")[write.address.col - table.start.col];
        if (!column) return false;
        if (
          cols &&
          children(cols, "tableColumn").some(
            (c) =>
              c !== column &&
              value(c, "name")?.toLowerCase() ===
                write.value!.toString().toLowerCase(),
          )
        )
          return false;
        if (value(column, "name") !== write.value) {
          if (
            cols &&
            children(cols, "tableColumn").some(
              (c) =>
                child(c, "calculatedColumnFormula") ||
                child(c, "totalsRowFormula"),
            )
          )
            return false;
          const name =
            value(table.doc.root, "name") ??
            value(table.doc.root, "displayName") ??
            "";
          // A structured-reference rename needs a spreadsheet formula editor.
          // Retain that graph and relocate only this changed caption instead.
          if (
            this.entries.some(
              (e) =>
                e.name.toLowerCase().endsWith(".xml") &&
                decoder
                  .decode(e.data)
                  .toLowerCase()
                  .includes(`${name.toLowerCase()}[`),
            )
          )
            return false;
          if (
            child(table.doc.root, "tableColumns") &&
            children(
              child(table.doc.root, "tableColumns")!,
              "tableColumn",
            ).some(
              (c) =>
                child(c, "calculatedColumnFormula") ||
                child(c, "totalsRowFormula"),
            )
          )
            return false;
        }
      }
    return true;
  }
  private style(code: string, baseIndex: number): number {
    const key = `${baseIndex}/${code}`,
      cached = this.styleCache.get(key);
    if (cached !== undefined) return cached;
    if (this.stylesPart === null) {
      const rel = this.rels(this.owner).find(
        (r) =>
          [NS.officeDocRels + "/styles", strictRels + "/styles"].includes(
            value(r, "Type") ?? "",
          ) && value(r, "TargetMode") !== "External",
      );
      if (rel)
        this.stylesPart = resolveTarget(this.owner, value(rel, "Target") ?? "");
      else {
        const zip = readZip(
            buildEmbeddedXlsx([], [], {
              seriesNumberFormats: [code === "General" ? "0" : code],
            }),
          ).entries,
          raw = zip.find((e) => e.name === "xl/styles.xml")!;
        this.stylesPart = this.freePart(
          `${dirname(this.owner).replace(/\/$/, "")}/styles`,
          ".xml",
        );
        const doc = parseXml(
          decoder.decode(raw.data).replaceAll(NS.sml, this.ns),
        );
        this.addPart(
          this.stylesPart,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
          doc,
        );
        this.addRelationship(
          this.owner,
          this.relNamespace + "/styles",
          this.stylesPart,
        );
      }
    }
    const doc = this.xml(this.stylesPart),
      root = doc.root,
      xfList = child(root, "cellXfs"),
      xfs = xfList && children(xfList, "xf");
    if (!xfList || !xfs || !xfs[baseIndex])
      throw new UneditableWorkbookRange("cell formatting is not editable");
    let formats = child(root, "numFmts"),
      id = 0;
    if (code !== "General") {
      const existing =
        formats &&
        children(formats, "numFmt").find(
          (f) => value(f, "formatCode") === code,
        );
      if (existing) id = readChartUnsignedInt(value(existing, "numFmtId")) ?? 0;
      else {
        if (!formats) {
          formats = node(root, "numFmts", { count: "0" });
          root.children.unshift(formats);
        }
        const used = new Set(
          children(formats, "numFmt").map((f) => Number(value(f, "numFmtId"))),
        );
        id = 164;
        while (used.has(id)) id++;
        formats.children.push(
          node(root, "numFmt", { numFmtId: String(id), formatCode: code }),
        );
        set(formats, "count", String(children(formats, "numFmt").length));
        this.mark(this.stylesPart);
      }
    }
    const xf = withInheritedNamespaces(xfs[baseIndex]!, [root, xfList]);
    set(xf, "numFmtId", String(id));
    set(xf, "applyNumberFormat", "1");
    const canonical = (n: XmlNode): unknown =>
      n.kind === "element"
        ? [
            n.name.namespaceURI,
            n.name.localName,
            n.attrs
              .map((a) => [a.name.namespaceURI, a.name.localName, a.value])
              .sort((a, b) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)),
              ),
            n.children.map(canonical),
          ]
        : n;
    const signature = JSON.stringify(canonical(xf));
    const index = xfs.findIndex(
      (n) => JSON.stringify(canonical(n)) === signature,
    );
    if (index >= 0) {
      this.styleCache.set(key, index);
      return index;
    }
    xfList.children.push(xf);
    set(xfList, "count", String(xfs.length + 1));
    this.mark(this.stylesPart);
    this.styleCache.set(key, xfs.length);
    return xfs.length;
  }
  write(write: WorkbookWrite) {
    if (!this.canWrite(write))
      throw new UneditableWorkbookRange("native target is not a value cell");
    const sheet = this.sheet(write.sheet),
      key = cellName(write.address);
    let cell = sheet.cells.get(key),
      row = sheet.rows.get(write.address.row);
    if (!row) {
      const data = child(sheet.doc.root, "sheetData")!;
      if (!sheet.rowsExplicit) {
        for (const [index, existing] of sheet.rows)
          if (value(existing, "r") === null)
            set(existing, "r", String(index + 1));
        sheet.rowsExplicit = true;
      }
      row = node(data, "row", { r: String(write.address.row + 1) });
      const tail = data.children.at(-1),
        last =
          tail?.kind === "element" && tail.name.localName === "row"
            ? tail
            : null;
      let at =
        last && Number(value(last, "r")) < write.address.row + 1
          ? -1
          : data.children.findIndex(
              (n) =>
                sameNode(n, data.name.namespaceURI, ["row"]) &&
                Number(value(n as XmlElement, "r")) > write.address.row + 1,
            );
      data.children.splice(at < 0 ? data.children.length : at, 0, row);
      sheet.rows.set(write.address.row, row);
    }
    if (!cell) {
      // Assign explicit addresses before insertion so implicit cells cannot move.
      if (sheet.implicitCellRows.delete(write.address.row)) {
        let column = -1;
        for (const existing of children(row, "c")) {
          column = cellAddress(value(existing, "r"))?.col ?? column + 1;
          if (value(existing, "r") === null)
            set(
              existing,
              "r",
              cellName({ row: write.address.row, col: column }),
            );
        }
      }
      set(row, "r", String(write.address.row + 1));
      cell = node(row, "c", { r: key });
      if (write.prototype && value(write.prototype, "s") !== null)
        set(cell, "s", value(write.prototype, "s"));
      const tail = row.children.at(-1),
        last =
          tail?.kind === "element" && tail.name.localName === "c" ? tail : null;
      let at =
        last && (cellAddress(value(last, "r"))?.col ?? -1) < write.address.col
          ? -1
          : row.children.findIndex(
              (n) =>
                sameNode(n, row!.name.namespaceURI, ["c"]) &&
                (cellAddress(value(n as XmlElement, "r"))?.col ?? -1) >
                  write.address.col,
            );
      row.children.splice(at < 0 ? row.children.length : at, 0, cell);
      sheet.cells.set(key, cell);
    }
    const oldType = value(cell, "t");
    if (write.value !== undefined) {
      cell.children = cell.children.filter(
        (n) => !sameNode(n, cell!.name.namespaceURI, ["v", "is"]),
      );
      set(cell, "t", typeof write.value === "string" ? "inlineStr" : null);
      if (write.value !== null) {
        const payload =
          typeof write.value === "string"
            ? node(cell, "is", {}, [node(cell, "t", {}, [text(write.value)])])
            : node(cell, "v", {}, [text(String(write.value))]);
        if (typeof write.value === "string")
          (payload.children[0] as XmlElement).attrs.push(
            attr(
              qname("xml", "space", "http://www.w3.org/XML/1998/namespace"),
              "preserve",
            ),
          );
        const at = cell.children.findIndex((n) =>
          sameNode(n, cell!.name.namespaceURI, ["extLst"]),
        );
        cell.children.splice(at < 0 ? cell.children.length : at, 0, payload);
      }
    }
    if (write.numberFormat !== undefined)
      set(
        cell,
        "s",
        String(
          this.style(
            write.numberFormat,
            readChartUnsignedInt(value(cell, "s")) ?? 0,
          ),
        ),
      );
    if (oldType === "s" && write.value !== undefined) {
      const rel = this.rels(this.owner).find((r) =>
        [
          NS.officeDocRels + "/sharedStrings",
          strictRels + "/sharedStrings",
        ].includes(value(r, "Type") ?? ""),
      );
      if (rel) {
        const part = resolveTarget(this.owner, value(rel, "Target") ?? ""),
          strings = this.xml(part);
        set(strings.root, "count", null);
        set(strings.root, "uniqueCount", null);
        this.mark(part);
      }
    }
    for (const table of this.tables(sheet))
      if (
        write.address.row === table.start.row &&
        write.address.col >= table.start.col &&
        write.address.col <= table.end.col &&
        typeof write.value === "string" &&
        value(table.doc.root, "headerRowCount") !== "0"
      ) {
        const columns = child(table.doc.root, "tableColumns")!,
          column = children(columns, "tableColumn")[
            write.address.col - table.start.col
          ]!;
        set(column, "name", write.value);
        this.mark(table.part);
      }
    const dimension = child(sheet.doc.root, "dimension");
    if (dimension) {
      const refs = value(dimension, "ref")?.split(":"),
        lo = cellAddress(refs?.[0] ?? null),
        hi = cellAddress(refs?.[1] ?? refs?.[0] ?? null);
      if (lo && hi) {
        const min = {
            row: Math.min(lo.row, write.address.row),
            col: Math.min(lo.col, write.address.col),
          },
          max = {
            row: Math.max(hi.row, write.address.row),
            col: Math.max(hi.col, write.address.col),
          };
        set(dimension, "ref", `${cellName(min)}:${cellName(max)}`);
      }
    }
    this.mark(sheet.part);
  }
  extendTables(
    ranges: ReadonlyArray<{ before: WorkbookRange; after: WorkbookRange }>,
  ) {
    for (const name of new Set(
      ranges.map((r) => r.before.sheet.toLowerCase()),
    )) {
      const sheet = this.sheet(name);
      for (const table of this.tables(sheet)) {
        if (
          (value(table.doc.root, "totalsRowCount") &&
            value(table.doc.root, "totalsRowCount") !== "0") ||
          !["0", "false"].includes(
            value(table.doc.root, "totalsRowShown")?.trim() ?? "",
          )
        )
          continue;
        const own = ranges.filter(
          (r) =>
            r.before.sheet.toLowerCase() === sheet.name.toLowerCase() &&
            r.before.start.col === r.before.end.col &&
            r.before.start.row === table.start.row + 1 &&
            r.before.end.row === table.end.row &&
            r.before.start.col >= table.start.col &&
            r.before.end.col <= table.end.col,
        );
        const covered = new Set(own.map((r) => r.before.start.col));
        if (covered.size !== table.end.col - table.start.col + 1) continue;
        const row = Math.max(table.end.row, ...own.map((r) => r.after.end.row));
        if (row === table.end.row) continue;
        const columns = child(table.doc.root, "tableColumns");
        if (
          ["queryTable", "xml"].includes(
            value(table.doc.root, "tableType") ?? "",
          )
        )
          continue;
        if (
          columns &&
          children(columns, "tableColumn").some(
            (c) =>
              child(c, "calculatedColumnFormula") ||
              child(c, "totalsRowFormula"),
          )
        )
          continue;
        const ref = `${cellName(table.start)}:${cellName({ row, col: table.end.col })}`;
        set(table.doc.root, "ref", ref);
        const filter = child(table.doc.root, "autoFilter");
        if (filter) set(filter, "ref", ref);
        this.mark(table.part);
      }
    }
  }
  setCalendar(date1904: boolean) {
    let props = child(this.workbook.root, "workbookPr");
    const raw = props
        ? value(props, "date1904")?.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "")
        : null,
      current =
        raw == null || raw === "0" || raw === "false"
          ? false
          : raw === "1" || raw === "true"
            ? true
            : null;
    if (current === date1904) return;
    if (!props) {
      props = node(this.workbook.root, "workbookPr");
      const at = this.workbook.root.children.findIndex((n) =>
        sameNode(n, this.ns, [
          "workbookProtection",
          "bookViews",
          "sheets",
          "definedNames",
          "calcPr",
          "extLst",
        ]),
      );
      this.workbook.root.children.splice(
        at < 0 ? this.workbook.root.children.length : at,
        0,
        props,
      );
    }
    set(props, "date1904", date1904 ? "1" : "0");
    this.mark(this.owner);
  }
  recalculate() {
    let calc = child(this.workbook.root, "calcPr");
    if (!calc) {
      calc = node(this.workbook.root, "calcPr");
      const at = this.workbook.root.children.findIndex((n) =>
        sameNode(n, this.ns, [
          "oleSize",
          "customWorkbookViews",
          "pivotCaches",
          "smartTagPr",
          "smartTagTypes",
          "webPublishing",
          "fileRecoveryPr",
          "webPublishObjects",
          "extLst",
        ]),
      );
      this.workbook.root.children.splice(
        at < 0 ? this.workbook.root.children.length : at,
        0,
        calc,
      );
    }
    set(calc, "fullCalcOnLoad", "1");
    set(calc, "forceFullCalc", "1");
    this.mark(this.owner);
  }
  newSheet(): string {
    let i = 1,
      name = "Chart Data";
    while (this.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      name = `Chart Data (${++i})`;
    const ids = new Set(
      this.sheets.map((s) => Number(value(s.element, "sheetId"))),
    );
    let sheetId = 1;
    while (ids.has(sheetId)) sheetId++;
    const part = this.freePart(
        `${dirname(this.owner).replace(/\/$/, "")}/worksheets/chartData`,
        ".xml",
      ),
      doc = parseXml(`<worksheet xmlns="${this.ns}"><sheetData/></worksheet>`);
    this.addPart(
      part,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
      doc,
    );
    const id = this.addRelationship(
        this.owner,
        this.relNamespace + "/worksheet",
        part,
      ),
      list = child(this.workbook.root, "sheets")!,
      el = node(list, "sheet", { name, sheetId: String(sheetId) });
    el.attrs.push(attr(qname("r", "id", this.relNamespace), id));
    list.children.push(el);
    const info = { name, part, element: el, worksheet: true };
    this.sheets.push(info);
    this.loadedSheets.set(part, {
      ...info,
      doc,
      rows: new Map(),
      cells: new Map(),
      formulaRanges: [],
      rowsExplicit: true,
      implicitCellRows: new Set(),
    });
    this.mark(this.owner);
    return name;
  }
  save(): Uint8Array {
    if (this.dirty.size === 0) return this.bytes;
    return writeZip(
      this.entries.map((entry) => {
        const key = `/${entry.name}`.toLowerCase();
        return this.dirty.has(key)
          ? {
              name: entry.name,
              data: encoder.encode(serializeXml(this.docs.get(key)!)),
            }
          : entry;
      }),
    );
  }
}
