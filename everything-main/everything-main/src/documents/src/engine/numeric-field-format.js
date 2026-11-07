import { UnsupportedDocumentError } from './errors.js';

const fail = message => { throw new UnsupportedDocumentError(message); };
const separators = new Intl.NumberFormat().formatToParts(1234.5);
const group = separators.find(p => p.type === 'group')?.value ?? ',';
const decimal = separators.find(p => p.type === 'decimal')?.value ?? '.';

// ECMA-376 §17.16.4.2. Compile once at import; keep the original instruction
// separately so rendering never rewrites a field's source or cached result.
export function numericFieldFormat(picture) {
  const sections = [[]];
  for (let i = 0; i < picture.length; i++) {
    const char = picture[i], section = sections.at(-1);
    if (char === "'") {
      const end = picture.indexOf("'", i + 1);
      if (end < 0) fail('an unterminated numeric field literal');
      section.push({ literal: picture.slice(i + 1, end) }); i = end;
    } else if (char === '`') fail('a numeric field SEQ reference');
    else if (char === ';') {
      if (sections.length === 3) fail('too many numeric field format sections');
      sections.push([]);
    } else section.push('0#x.,+-'.includes(char) ? { token: char } : { literal: char });
  }
  for (const section of sections) {
    const radix = section.findIndex(item => item.token === '.');
    if (section.filter(item => item.token === '.').length > 1 ||
        (radix >= 0 && section.slice(radix + 1).some(item => item.token === ','))) fail('an unsupported numeric field radix/grouping pattern');
  }
  return sections;
}

// Page fields yield nonnegative integers. Decimal placeholders still matter:
// Optional fractional blanks print (and a first zero for numeric zero),
// while a trailing fractional x adds no padding. An initial integer x limits
// the significant digits; an x after a 0/# is an ordinary optional position.
export function formatNumericField(value, sections) {
  const section = sections[value === 0 && sections.length === 3 ? 2 : 0];
  const radix = section.findIndex(item => item.token === '.');
  const integer = section.slice(0, radix < 0 ? section.length : radix);
  const slots = integer.map((item, i) => '0#x'.includes(item.token ?? '\0') ? i : -1).filter(i => i >= 0);
  let digits = value === 0 ? '' : String(value);
  if (slots.length && integer[slots[0]].token === 'x') digits = digits.slice(-slots.length);
  const output = section.map(item => item.literal ?? '');
  for (let i = slots.length - 1; i >= 0; i--) {
    const at = slots[i];
    output[at] = digits ? digits.slice(-1) : integer[at].token === '0' ? '0' : ' ';
    digits = digits.slice(0, -1);
  }
  if (digits && slots.length) output[slots[0]] = digits + output[slots[0]];
  let fractionAt = 0;
  for (let i = 0; i < section.length; i++) {
    const token = section[i].token;
    if (token === '+') output[i] = value ? '+' : ' ';
    if (token === '-') output[i] = ' ';
    if (i > radix && radix >= 0 && '0#x'.includes(token ?? '\0')) {
      output[i] = token === '0' || (value === 0 && fractionAt === 0 && token === '#') ? '0' : token === 'x' ? '' : ' ';
      fractionAt++;
    }
  }
  // Group the actual integer digits, not padded spaces. Commas in the picture
  // enable grouping; unused separators do not consume a character position.
  if (radix >= 0) output[radix] = decimal;
  if (integer.some(item => item.token === ',')) {
    let count = 0;
    for (let i = slots.length - 1; i >= 0; i--) {
      const at = slots[i];
      output[at] = [...output[at]].reverse().map(char => {
        if (!/[0-9]/.test(char)) return char;
        return char + (count++ && (count - 1) % 3 === 0 ? group : '');
      }).reverse().join('');
    }
  }
  return output.join('');
}
