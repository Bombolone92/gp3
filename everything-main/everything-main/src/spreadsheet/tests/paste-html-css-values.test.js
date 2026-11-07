// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

// Web pages write their cell styles in more ways than the reader knew: a declaration marked
// !important compared unequal to "bold", a background shorthand hid its colour behind an
// image, and hsl(), percentage rgb() and most named colours read as no colour at all, so
// the pasted cells came in plain.
describe('CSS values in pasted HTML cells', () => {
  const cell = (style) => parseHtmlClipboard(`<table><tr><td style="${style}">x</td></tr></table>`).rows[0][0];

  it('reads declarations marked !important', () => {
    expect(cell('font-weight:bold !important;color:#ff0000 !important;background-color:#ffff00!important').style).toEqual({ bold: true, color: '#ff0000', bg: '#ffff00' });
    expect(cell('font-style: italic ! important; text-align: right !IMPORTANT; white-space: pre-wrap !important').style).toEqual({ italic: true, align: 'right', wrap: true });
  });

  it('takes the colour out of a background shorthand', () => {
    expect(cell('background:#ff0 url(x.png) no-repeat').style).toEqual({ bg: '#ffff00' });
    expect(cell('background: url(x.png) rgb(0, 128, 0)').style).toEqual({ bg: '#008000' });
    expect(cell('background: url(https://evil.example/b) center / cover').style).toBeUndefined();
  });

  it('reads hsl() and percentage rgb() colours', () => {
    expect(cell('color:hsl(0,100%,50%)').style).toEqual({ color: '#ff0000' });
    expect(cell('color:hsl(120 100% 25%)').style).toEqual({ color: '#008000' });
    expect(cell('color:hsl(240deg, 100%, 50%)').style).toEqual({ color: '#0000ff' });
    expect(cell('color:rgb(100%,0%,0%)').style).toEqual({ color: '#ff0000' });
    expect(cell('background-color:hsla(240, 100%, 50%, 0.5)').style).toEqual({ bg: '#0000ff' });
    expect(cell('background-color:rgb(0 128 0 / 50%)').style).toEqual({ bg: '#008000' });
  });

  it('knows the CSS named colours, and Excel\'s windowtext', () => {
    expect(cell('color:purple').style).toEqual({ color: '#800080' });
    expect(cell('background-color:LightGoldenRodYellow').style).toEqual({ bg: '#fafad2' });
    expect(cell('color:rebeccapurple').style).toEqual({ color: '#663399' });
    expect(cell('color:windowtext').style).toEqual({ color: 'windowtext' }); // explicit ink overrides a destination's colored Normal font
    expect(cell('color:notacolour').style).toBeUndefined();
  });

  it('reads a fully transparent colour as none rather than as black', () => {
    expect(cell('background-color: rgba(0, 0, 0, 0)').style).toBeUndefined();
    expect(cell('background-color: #00000000').style).toBeUndefined();
    expect(cell('background-color: #ff000080').style).toEqual({ bg: '#ff0000' });
    expect(cell('background-color: transparent').style).toBeUndefined();
  });
});
