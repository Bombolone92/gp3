"""Compare hash-bound native PDF character origins with local browser diagnostics.

Usage: python tools/compare-font-version-text.py native-word.pdf output-directory
The LTR ASCII oracle excludes native ligature decompositions and rejects SVG
origins whose advance disagrees with Canvas. This is not a pixel comparison.
"""
from pathlib import Path
import ctypes,json,re,sys,hashlib
import pypdfium2 as pdf

reference=Path(sys.argv[1]);folder=Path(sys.argv[2]);doc=pdf.PdfDocument(reference);native=[]
for page_number,page in enumerate(doc):
    text=page.get_textpage();lines=[];last_x=None
    for i in range(text.count_chars()):
        char=text.get_text_range(i,1)
        if char in '\r\n':continue
        x,y=ctypes.c_double(),ctypes.c_double()
        pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y));baseline=page.get_height()-y.value
        if not lines or abs(lines[-1]['baseline']-baseline)>.5 or last_x is not None and (x.value-last_x>max(24,2.5*pdf.raw.FPDFText_GetFontSize(text,i)) or x.value<last_x-24):
            lines.append({'page':page_number,'baseline':baseline,'text':'','origins':[]})
        lines[-1]['text']+=char;lines[-1]['origins'].append(x.value);last_x=x.value
    for line in lines:
        offset=re.match(r'^\s*(?:\u2022\s*)?',line['text']).end()
        line['text']=line['text'][offset:];line['origins']=line['origins'][offset:]
    native.extend(lines)
results=[]
for mode in ['bundled','candidate']:
    path=folder/f'{mode}-typography.json';data=json.loads(path.read_text());actual=[]
    for line in data['lines']:
        fragments=line['fragments'];text=''.join(f['text'] for f in fragments)
        offset=re.match(r'^\s*(?:\u2022\s*)?',text).end();text=text[offset:].rstrip()
        if text:actual.append({'text':text,'page':line['page'],'baseline':line['baseline']*.75,
            'origins':[x for f in fragments for x in f.get('glyphs',[])][offset:offset+len(text)],
            'skipped':any(f.get('skipped') for f in fragments),
            'advanceError':max((f.get('advanceError',0) for f in fragments),default=0)})
    remaining=actual.copy();rows=[];unmatched=[];skipped=[]
    for ref in native:
        text=ref['text'].rstrip()
        if not text:continue
        hit=next((a for a in remaining if a['text']==text and a['page']==ref['page']),None)
        if not hit:unmatched.append(text);continue
        remaining.remove(hit)
        reason=None
        if hit['skipped'] or not re.fullmatch(r'[ -~]+',text):reason='outside the LTR ASCII oracle'
        elif len(hit['origins'])!=len(text) or len(ref['origins'])<len(text):reason='character/origin counts differ'
        elif hit['advanceError']>.01:reason='SVG advance disagrees with Canvas'
        elif any(text[i-1]!=' ' and text[i]!=' ' and abs(ref['origins'][i]-ref['origins'][i-1])<.01 for i in range(1,len(text))):reason='native decomposed ligature'
        if reason:skipped.append({'text':text,'reason':reason});continue
        errors=[abs(hit['origins'][i]-ref['origins'][i]) for i in range(len(text))]
        rows.append({'text':text,'characters':len(text),'maxGlyphOriginErrorPt':max(errors),
            'baselineErrorPt':hit['baseline']-ref['baseline'],'canvasSvgAdvanceErrorPx':hit['advanceError']})
    assert rows, 'No valid shaped-origin comparisons'
    results.append({'mode':mode,'typographySha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'matchedAsciiLines':len(rows),'characters':sum(r['characters'] for r in rows),
        'maxGlyphOriginErrorPt':max(r['maxGlyphOriginErrorPt'] for r in rows),
        'maxBaselineErrorPt':max(abs(r['baselineErrorPt']) for r in rows),
        'maxCanvasSvgAdvanceErrorPx':max(r['canvasSvgAdvanceErrorPx'] for r in rows),
        'unmatchedNative':unmatched,'unmatchedBrowser':[a['text'] for a in remaining],'skipped':skipped,'rows':rows})
output={'pdfSha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'method':'PDFium native character origins versus complete-fragment SVG origins, validated against Canvas advances','runs':results}
(folder/'shaped-comparison.json').write_text(json.dumps(output,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in run.items() if k not in ['rows','skipped']} for run in results],indent=2))
