// Detects document types and extracts their content into document models.
import { extractPptx, extractDocx, openXlsx } from "./office.js";
import { parseCSV } from "./tables.js";
import { parseText, TEXT_CHARACTERS } from "./text-import.js";
import { extractPdf, PDF_BYTES } from "./pdf.js";
import { decodeText, extension } from "./binary.js";
// CSV text, including Google Sheets, is read up to 5,000 rows and 500
// columns (tables.js).
export const CSV_LIMIT = "Rows or columns beyond 5,000 rows and 500 columns";

export const DOCUMENT_KINDS = {
  pdf: { label: "PDF", limit: PDF_BYTES },
  pptx: { label: "PowerPoint", limit: 50 * 1024 * 1024 },
  docx: { label: "Word", limit: 50 * 1024 * 1024 },
  xlsx: { label: "Excel", limit: 50 * 1024 * 1024 },
  csv: { label: "CSV", limit: 5 * 1024 * 1024 },
  text: { label: "Text", limit: TEXT_CHARACTERS },
  // Markdown can carry its pictures as data, which is dropped on import.
  markdown: { label: "Markdown", limit: 20 * 1024 * 1024 },
};
export const IMPORT_ACCEPT =
  ".pdf,.pptx,.docx,.xlsx,.csv,.tsv,.txt,.md,.markdown,application/pdf,text/csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LEGACY = new Set(["doc", "ppt", "xls", "pps", "rtf"]);

export function documentKind(file) {
  const ext = extension(file?.name);
  const type = (file?.type || "").toLowerCase();
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (ext === "pptx" || type.endsWith("presentationml.presentation"))
    return "pptx";
  if (ext === "docx" || type.endsWith("wordprocessingml.document"))
    return "docx";
  if (ext === "xlsx" || type.endsWith("spreadsheetml.sheet")) return "xlsx";
  if (["csv", "tsv"].includes(ext) || type === "text/csv") return "csv";
  if (["md", "markdown"].includes(ext) || type === "text/markdown")
    return "markdown";
  if (ext === "txt" || type === "text/plain") return "text";
  return null;
}
export const isLegacyOffice = (file) => LEGACY.has(extension(file?.name));

export function checkFile(file, kind = documentKind(file)) {
  if (isLegacyOffice(file))
    throw Error(
      "Older Office formats (.doc, .ppt, .xls) are not supported. Save the file as .docx, .pptx, or .xlsx and import it again.",
    );
  if (!kind)
    throw Error(
      "Choose a PDF, PowerPoint, Word, Excel, CSV, text, or Markdown file.",
    );
  if (file.size > DOCUMENT_KINDS[kind].limit)
    throw Error(
      {
        csv: "Choose a CSV file smaller than 5 MB.",
        text: "Choose a text file smaller than 2 MB.",
        markdown: "Choose a Markdown file smaller than 20 MB.",
      }[kind] || "Choose a document smaller than 50 MB.",
    );
  return kind;
}

// Returns a document model, or for Excel an opened workbook whose sheets are
// read after the person picks one.
export async function extractDocument(kind, bytes, options = {}) {
  if (kind === "pdf") return extractPdf(bytes, options);
  if (kind === "pptx") return extractPptx(bytes, options);
  if (kind === "docx") return extractDocx(bytes, options);
  if (kind === "xlsx") return openXlsx(bytes, options);
  const text = decodeText(bytes);
  if (kind === "csv") {
    const { rows, truncated } = parseCSV(
      text,
      options.name?.toLowerCase().endsWith(".tsv") ? "\t" : undefined,
    );
    return {
      kind: "sheets",
      sheets: [
        { name: options.name || "CSV", rows, truncated, limit: CSV_LIMIT },
      ],
    };
  }
  return parseText(text, { markdown: kind === "markdown" });
}
