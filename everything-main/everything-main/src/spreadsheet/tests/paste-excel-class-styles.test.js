// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

// Excel's clipboard HTML carries cell formatting as classes declared in a
// <style> block (.xl65 {…}); the style attribute only holds borders and sizes.
const EXCEL = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta name=ProgId content=Excel.Sheet>
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";
	mso-displayed-thousand-separator:"\\,";}
@page
	{margin:.75in .7in .75in .7in;
	mso-header-margin:.3in;}
td
	{padding-top:1px;
	color:black;
	font-size:11.0pt;
	font-weight:400;
	font-style:normal;
	text-decoration:none;
	font-family:Calibri, sans-serif;
	mso-number-format:General;
	text-align:general;
	vertical-align:bottom;
	border:none;
	white-space:nowrap;}
.xl65
	{color:white;
	font-weight:700;
	text-align:center;
	background:#4472C4;
	mso-pattern:black none;}
.xl66
	{color:#C00000;
	font-style:italic;
	text-align:right;
	mso-number-format:"\\#\\,\\#\\#0\\.00";}
.xl67, .xl68
	{text-decoration:underline;
	font-family:Georgia, serif;}
-->
</style></head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=192 style='border-collapse:collapse;width:144pt'>
<col width=64 span=3 style='width:48pt'>
<tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Name</td>
  <td class=xl65 width=64 style='width:48pt'>Code</td>
  <td class=xl65 width=64 style='width:48pt'>Amount</td>
</tr>
<tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt;border-top:none'>Ann</td>
  <td class=xl68 style='border-top:none'>A-1</td>
  <td class=xl66 align=right style='border-top:none'>1,234.57</td>
</tr>
<tr height=20 style='height:15.0pt'>
  <td height=20 class="xl65 xl67" style='height:15.0pt;color:#FF0000'>Both</td>
  <td class=xl99>Unknown class</td>
  <td>Plain</td>
</tr>
</table>
</body></html>`;

describe('formatting from Excel class styles', () => {
  const parsed = parseHtmlClipboard(EXCEL);
  const base = { color: '#000000', font: 'calibri', size: 44 / 3, bold: false, italic: false,
    underline: false, strike: false, wrap: false, valign: 'bottom',
    bt: false, btBorder: null, br: false, brBorder: null, bb: false, bbBorder: null, bl: false, blBorder: null };

  it('reads bold, colour, fill and alignment declared for a class', () => {
    expect(parsed.rows[0].map((cell) => cell.text)).toEqual(['Name', 'Code', 'Amount']);
    for (const cell of parsed.rows[0]) expect(cell.style).toEqual({ ...base, bold: true, color: '#ffffff', bg: '#4472c4', align: 'center' });
  });

  it('reads italics, colour, alignment and the number format, and ignores Excel-only properties', () => {
    expect(parsed.rows[1][2]).toEqual({ text: '1,234.57', style: { ...base, italic: true, color: '#c00000', align: 'right', fmt: 'number', dec: 2, group: true } });
    expect(parsed.rows[1][0].style).toEqual(base);
  });

  it('applies grouped selectors and combines the classes of a cell, inline declarations winning', () => {
    expect(parsed.rows[1][1].style).toEqual({ ...base, underline: true, font: 'georgia' });
    expect(parsed.rows[2][0].style).toEqual({ ...base, bold: true, color: '#ff0000', bg: '#4472c4', align: 'center', underline: true, font: 'georgia' });
    expect(parsed.rows[2][1].style).toEqual(base);
    expect(parsed.rows[2][2].style).toEqual(base);
  });

  it('never applies pasted style sheets to the page', () => {
    const before = document.querySelectorAll('style').length;
    parseHtmlClipboard(EXCEL);
    expect(document.querySelectorAll('style').length).toBe(before);
    expect(getComputedStyle(document.body).backgroundColor).not.toBe('rgb(68, 114, 196)');
  });

  it('keeps reading inline styles without a style sheet', () => {
    const plain = parseHtmlClipboard('<table><tr><td class="x" style="font-weight:bold">a</td></tr></table>');
    expect(plain.rows[0][0].style).toEqual({ bold: true });
  });
});
