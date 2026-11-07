// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {parsePrintHeader,hasHeaderFormatting} from '../src/core/print-header.js';
import {richHeaderSections} from '../src/ui/print-header.js';
import {normalizePrintSettings} from '../src/core/print-settings.js';
import {Workbook} from '../src/core/workbook.js';
import {buildPrintRoot,preparePrintRoot,sheetPrintPrefs,printSettingsFromPrefs} from '../src/ui/print.js';
import {readXlsxPrint} from '../src/core/xlsx-print.js';
import {writeXlsxPrint} from '../src/core/xlsx-export-print.js';

it('parses mixed font, size, color, token and escaped-ampersand runs without treating quoted section codes as boundaries',()=>{
 const p=parsePrintHeader('&L&"Font &R,Italic"&12Red &KFF0000&BR&D && &P&CPlain');
 expect(p.left[0]).toMatchObject({text:'Red ',style:{font:'Font &R',italic:true,bold:false,size:12}});
 expect(p.left[1]).toMatchObject({text:'R',style:{bold:true,italic:true,color:'#ff0000'}});
 expect(p.left[2]).toMatchObject({token:'Date'});expect(p.left[3].text).toBe(' & ');expect(p.left[4].token).toBe('Page');
 expect(p.center).toEqual([{text:'Plain',style:{}}]);
});
it.each(['Bold','Fett','Gras','Negrita','Pogrubiony','太字'])('recognizes the localized font style %s',name=>{
 expect(parsePrintHeader(`&"-,${name}"Heading`).center[0].style).toMatchObject({bold:true,italic:false});
});
it('toggles styles, keeps superscript and subscript exclusive, and returns to regular',()=>{
 const runs=parsePrintHeader('&Bbold&Bplain&Xup&Ystill up&Xbase&Ydown&Ybase&"-,Bold Italic"both&"-,Regular"regular').center;
 expect(runs[0].style.bold).toBe(true);expect(runs[1].style.bold).toBe(false);
 expect(runs[2]).toMatchObject({text:'upstill up',style:{super:true}});expect(runs[3].style.super).toBe(false);
 expect(runs[4].style.sub).toBe(true);expect(runs.at(-1).style).toMatchObject({bold:false,italic:false});
});
it('resolves RGB and theme tints against the workbook palette',()=>{
 const p=parsePrintHeader('&K04+050Light&K04-050Dark&KABCDEFHex',{theme:[null,null,null,null,'#808080']});
 expect(p.center.map(r=>r.style.color)).toEqual(['#c0c0c0','#404040','#abcdef']);
});
it('does not discard malformed or unsupported codes and distinguishes escaped formatting markers',()=>{
 expect(hasHeaderFormatting('&&B literal &&KFF0000')).toBe(false);expect(hasHeaderFormatting('&&&Bbold')).toBe(true);
 expect(parsePrintHeader('&"unfinished &Kbroken &G').center.map(p=>p.text).join('')).toBe('&"unfinished &Kbroken &G');
});
it('renders styled Unicode runs and literal markup as text, with concrete page fields',()=>{
 const parts=richHeaderSections('&L&"Arial,Bold"&20<b>é</b>&C&U&P of &N&U&R&KFF0000End',{page:3,pages:7},.5);
 expect(parts.map(p=>p.textContent)).toEqual(['<b>é</b>','3 of 7','End']);expect(parts[0].querySelector('b')).toBeNull();
 expect(parts[0].firstChild.style.fontWeight).toBe('700');expect(parts[0].firstChild.style.fontSize).toBe('10pt');
 expect(parts[1].firstChild.style.textDecorationLine).toBe('underline');expect(parts[2].firstChild.style.color).toBe('rgb(255, 0, 0)');
});
it('preserves scaleWithDoc and header codes through native settings and preferences',()=>{
 const xml='<worksheet><headerFooter scaleWithDoc="0"><oddHeader>&amp;C&amp;BTitle</oddHeader></headerFooter></worksheet>';
 const settings=readXlsxPrint(xml,[],'Report',0),sheet={printSettings:settings};
 expect(settings.scaleWithDoc).toBe(false);expect(sheetPrintPrefs(sheet).scaleWithDoc).toBe(false);
 expect(printSettingsFromPrefs(sheet,sheetPrintPrefs(sheet)).scaleWithDoc).toBe(false);
 expect(writeXlsxPrint('<worksheet></worksheet>',settings)).toContain('scaleWithDoc="0"');
});
it('stages formatted headers without emitting their codes as margin-box text',()=>{
 const wb=new Workbook();wb.setInput(wb.activeSheetId,0,0,'Body');wb.activeSheet.printSettings=normalizePrintSettings({header:'&C&"Arial,Bold"&18Title',footer:'&R&P of &N',scaleWithDoc:false});
 const root=buildPrintRoot(wb,wb.activeSheetId,'Book',{marginBoxes:true});
 expect(root.querySelector('style').textContent).not.toContain('&18');
 expect(root.querySelector('.print-margin-text').textContent).toBe('Title');
 expect(root.querySelector('.print-margin-text span span').style.fontSize).toBe('18pt');
});


afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks()});
it.each([true,false])('places rich text in physical margins with margin boxes %s',marginBoxes=>{
 const wb=new Workbook({sheets:[{name:'Report',cells:{'0,0':{v:'Body'}},printSettings:{
  header:'&L&BLeft&C&20&P / &N&RRight',footer:'&C&IFooter',alignWithMargins:false,
  margins:{left:1.25,right:.5,top:.8,bottom:.6,header:.2,footer:.25},scale:50,scaleWithDoc:false,
 }}]});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,200,100));
 const root=buildPrintRoot(wb,wb.activeSheetId,'Book',{marginBoxes});document.body.append(root);preparePrintRoot(root);
 const section=root.querySelector('.print-section'),[header,footer]=section.querySelectorAll('.print-margin-text');
 expect(root.querySelector('style').textContent).toContain('margin: 0in 0in 0in 0in;');
 expect(section.style.marginLeft).toBe('120px');expect(parseFloat(section.style.paddingTop)).toBeCloseTo(76.8);
 expect(parseFloat(section.style.height)).toBeCloseTo(1056);
 expect(header.style.left).toBe('-120px');expect(header.style.width).toBe('816px');expect(parseFloat(header.style.top)).toBeCloseTo(19.2);
 expect(header.textContent).toBe('Left1 / 1Right');expect(header.children[1].firstChild.style.fontSize).toBe('20pt');
 expect(parseFloat(footer.style.top)).toBeCloseTo(1032);expect(footer.firstChild.style.transform).toBe('translateY(-100%)');
 expect(root.querySelector('.print-header-fonts')).toBeNull();
 const before=root.innerHTML;preparePrintRoot(root);expect(root.innerHTML).toBe(before);
});
it('uses the fitted scale for rich text unless scaleWithDoc is disabled',()=>{
 const wb=new Workbook({sheets:[{name:'Report',cells:{'0,0':{v:'Body'}},printSettings:{header:'&20Heading',scale:50}}]});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,200,100));
 const root=buildPrintRoot(wb,wb.activeSheetId,'Book');document.body.append(root);preparePrintRoot(root);
 expect(root.querySelector('.print-margin-text').children[1].firstChild.style.fontSize).toBe('10pt');
});
