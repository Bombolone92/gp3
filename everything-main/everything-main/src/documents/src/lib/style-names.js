/**
 * The name a word processor shows for a style. DOCX files store many built-in style names in lowercase
 * ("heading 1", "footnote text") and shows them capitalized, and shows some under newer names
 * ("annotation text" as Comment Text). Custom names, and any name with a capital, show as written.
 */
const RENAMED = {
  'annotation text': 'Comment Text', 'annotation reference': 'Comment Reference', 'annotation subject': 'Comment Subject',
  'table of figures': 'Table of Figures', 'table of authorities': 'Table of Authorities', 'toa heading': 'TOA Heading',
  'html preformatted': 'HTML Preformatted', 'html code': 'HTML Code', 'html address': 'HTML Address',
  'no list': 'No List', 'normal (web)': 'Normal (Web)',
};
export function styleDisplayName(name) {
  const value = String(name ?? '');
  if (!value || value !== value.toLowerCase()) return value;
  if (Object.hasOwn(RENAMED, value)) return RENAMED[value];
  const toc = /^toc (\d)$/.exec(value);
  if (toc) return `TOC ${toc[1]}`;
  return value.replace(/(^|[\s(])(\p{L})/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase());
}
