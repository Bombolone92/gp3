import { expect, it } from 'vitest';
import { xlsxElements, readXlsxStyles } from '../src/core/xlsx-styles.js';

it('keeps self-closing records separate from following paired records without shifting style indexes', () => {
  for (const name of ['xf', 'font', 'fill', 'border']) {
    const records = [`<${name} key="first"/>`, `<${name} key="second"><child/></${name}>`, `<x:${name} key="third" />`, `<x:${name} key="fourth"></x:${name}>`];
    expect(xlsxElements(`<root>${records.join('')}</root>`, name)).toEqual(records);
  }
});

it('resolves Normal through the correct style XF when empty and paired XFs are mixed', () => {
  const xml = '<styleSheet><fonts><font><name val="Arial"/><sz val="11"/></font><font><name val="Verdana"/><sz val="18"/></font></fonts>'
    + '<cellStyleXfs><xf fontId="0"/><xf fontId="1"><alignment vertical="center"/></xf></cellStyleXfs>'
    + '<cellStyles><cellStyle name="Normal" builtinId="0" xfId="1"/></cellStyles></styleSheet>';
  const styles = readXlsxStyles({ files: { 'xl/styles.xml': { content: new TextEncoder().encode(xml) } } });
  expect(styles.normalFont).toMatchObject({ name: 'Verdana', sz: 18 });
  expect(styles.normalFontId).toBe(1);
});
