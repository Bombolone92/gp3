import { xlsxText } from './xlsx-styles.js';
import { normalizeCalculationCompatibility } from './calculation-compatibility.js';

export const COMPATIBILITY_NAMESPACE = 'http://schemas.microsoft.com/office/spreadsheetml/2024/workbookCompatibilityVersion';
export const COMPATIBILITY_EXTENSION = '{D14903EA-33C4-47F7-8F05-3474C54BE107}';
const MAIN = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']);

/** Older Excel workbooks without the extension use Version 1.
 * MS-XLSX 2.6.259 CT_Version, 2.6.260 CT_WorkbookCompatibilityVersionExt.
 */
export function readXlsxCalculationCompatibility(xml) {
  const source = (xml || '').replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
  const tags = /<\/?([\w.-]+(?::[\w.-]+)?)(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  const stack = [];
  for (const [tag, qualified] of source.matchAll(tags)) {
    if (tag.startsWith('</')) { stack.pop(); continue; }
    const parent = stack.at(-1), namespaces = Object.assign(Object.create(null), parent?.namespaces);
    const attrs = Object.fromEntries([...tag.matchAll(/\s([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, key, double, single]) => [key, xlsxText(double ?? single)]));
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'xmlns') namespaces[''] = value;
      else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = value;
    }
    const parts = qualified.split(':'), name = parts.at(-1), uri = namespaces[parts.length > 1 ? parts[0] : ''];
    const frame = { name, uri, namespaces };
    if (name === 'workbook' && !parent && MAIN.has(uri)) frame.workbook = true;
    if (name === 'extLst' && parent?.workbook && uri === parent.uri) frame.extensions = true;
    if (name === 'ext' && parent?.extensions && uri === parent.uri) {
      frame.compatibility = attrs.uri?.toUpperCase() === COMPATIBILITY_EXTENSION;
    }
    if (name === 'version' && parent?.compatibility && uri === COMPATIBILITY_NAMESPACE) {
      const read = key => {
        const value = attrs[key];
        return typeof value === 'string' && /^\+?\d+$/.test(value.trim()) ? Number(value) : undefined;
      };
      return normalizeCalculationCompatibility({ version: read('setVersion'), warnBelowVersion: read('warnBelowVersion') }, 1);
    }
    if (!tag.endsWith('/>')) stack.push(frame);
  }
  return { version: 1 };
}
