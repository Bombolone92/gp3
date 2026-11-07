// Comma- and tab-separated text (RFC 4180 style): fields may be quoted with
// double quotes, a doubled quote inside a quoted field is a literal quote,
// and quoted fields may contain delimiters and line breaks. Lines end with
// LF, CRLF or CR; a leading byte order mark is ignored.

export type Delimiter = ',' | '\t' | ';';

// The delimiter of a table: tab when the first line has one, else the more
// frequent of comma and semicolon outside quotes.
export function detectDelimiter(text: string): Delimiter {
  let inQuotes = false;
  let commas = 0,
    semis = 0,
    tabs = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === '\n' || c === '\r') break;
      if (c === '\t') tabs++;
      else if (c === ',') commas++;
      else if (c === ';') semis++;
    }
  }
  if (tabs) return '\t';
  return semis > commas ? ';' : ',';
}

export function parseDelimited(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false; // inside a quoted field
  let i = 0;
  const n = text.length;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      endField();
      i++;
    } else if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  // The last line, unless the text ended with a line break.
  if (field !== '' || row.length || quoted) endRow();
  // Blank lines carry no data.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// One field, quoted when needed.
function quoteField(v: string, delimiter: Delimiter) {
  return /["\r\n]/.test(v) || v.includes(delimiter) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
export function formatDelimited(rows: string[][], delimiter: Delimiter = ','): string {
  return rows.map((r) => r.map((v) => quoteField(v, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
