"""Verify native named faces before accepting independent glyph references."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdf
import ctypes,hashlib,json

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/named-semibold-kerning'
cases=json.loads((folder/'cases.json').read_text());controls=[]
hashfile=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
for enabled in [0,1]:
    source=folder/f'control-{enabled}.docx';path=folder/f'native-{enabled}.pdf'
    reader=PdfReader(path);assert len(reader.pages)==1
    fonts=[]
    def visit(text,cm,tm,font,size):
        if text.strip():fonts.append(str(font['/BaseFont']).split('+')[-1])
    reader.pages[0].extract_text(visitor_text=visit);assert len(fonts)==len(cases)
    for case,font in zip(cases,fonts):
        assert font.split(',')[0]==case['family'],(case,font)
        assert ('Italic' in font)==case['italic'],(case,font)
        if case['family']=='Open Sans SemiBold':assert ('Bold' in font.split(',')[-1] if ',' in font else False)==case['bold'],(case,font)
    document=pdf.PdfDocument(path);page=document[0];text=page.get_textpage();lines=[]
    for i in range(text.count_chars()):
        char=text.get_text_range(i,1)
        if char in '\r\n':continue
        x,y=ctypes.c_double(),ctypes.c_double()
        pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y));baseline=page.get_height()-y.value
        if not lines or abs(lines[-1]['baseline']-baseline)>.5:lines.append(dict(text='',baseline=baseline,origins=[]))
        lines[-1]['text']+=char;lines[-1]['origins'].append(x.value)
    assert len(lines)==len(cases)
    for case,line,font in zip(cases,lines,fonts):
        assert line['text']==case['text'];assert len(line['origins'])==len(case['text']);line['font']=font
    controls.append(dict(enabled=enabled,sourceSha256=hashfile(source),pdfSha256=hashfile(path),lines=lines))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',
    method='PDFium glyph origins and pypdf per-line named-font selection',controls=controls),indent=2)+'\n',encoding='utf-8')
