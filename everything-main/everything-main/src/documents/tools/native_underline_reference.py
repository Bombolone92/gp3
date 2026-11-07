"""Record numeric OpenType facts and independently measured reference underlines.

Reads installed fonts only; never copies font data or glyphs into the project.
"""
from pathlib import Path
import ctypes as c
import hashlib
import json
import struct
import pypdfium2 as pdf

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/native-underlines'
FILES={
    'Arial':['arial.ttf','arialbd.ttf','ariali.ttf','arialbi.ttf'],
    'Calibri':['calibri.ttf','calibrib.ttf','calibrii.ttf','calibriz.ttf'],
    'Times New Roman':['times.ttf','timesbd.ttf','timesi.ttf','timesbi.ttf'],
    'Cambria':['cambria.ttc','cambriab.ttf','cambriai.ttf','cambriaz.ttf'],
}

def font_facts(path):
    b=path.read_bytes();start=struct.unpack_from('>I',b,12)[0] if b[:4]==b'ttcf' else 0
    tables={}
    for i in range(struct.unpack_from('>H',b,start+4)[0]):
        tag,_,offset,_=struct.unpack_from('>4sIII',b,start+12+i*16);tables[tag.decode()]=offset
    units=struct.unpack_from('>H',b,tables['head']+18)[0]
    position,thickness=struct.unpack_from('>hh',b,tables['post']+8)
    ascent,descent,gap=struct.unpack_from('>hhh',b,tables['hhea']+4)
    win_ascent,win_descent=struct.unpack_from('>HH',b,tables['OS/2']+74)
    return dict(file=path.name,sha256=hashlib.sha256(b).hexdigest(),units=units,position=position,thickness=thickness,
                hheaAscent=ascent,hheaDescent=descent,hheaLineGap=gap,winAscent=win_ascent,winDescent=win_descent)

def record():
    cases=json.loads((ROOT/'cases.json').read_text());doc=pdf.PdfDocument(ROOT/'native.pdf');assert len(doc)==16
    fonts={family:[font_facts(Path('C:/Windows/Fonts')/name) for name in files] for family,files in FILES.items()}
    rows=[]
    for page_index,page in enumerate(doc):
        text=page.get_textpage();search=text.search('Underline sample');baselines=[]
        while (found:=search.get_next()) is not None:
            at,_=found;x,y=c.c_double(),c.c_double();pdf.raw.FPDFText_GetCharOrigin(text,at,c.byref(x),c.byref(y));baselines.append(page.get_height()-y.value)
        assert len(baselines)==6,(page_index,baselines)
        rects=[]
        for obj in page.get_objects(max_depth=10):
            if obj.type!=pdf.raw.FPDF_PAGEOBJ_PATH:continue
            rgba=[c.c_uint() for _ in range(4)];mode,stroke=c.c_int(),c.c_int()
            if not pdf.raw.FPDFPageObj_GetFillColor(obj,*[c.byref(v) for v in rgba]):continue
            if not pdf.raw.FPDFPath_GetDrawMode(obj,c.byref(mode),c.byref(stroke)) or not mode.value:continue
            r,g,b,a=[v.value for v in rgba]
            if r<2 and 120<g<135 and 120<b<135 and a==255:
                x,y,right,top=obj.get_bounds();rects.append(dict(x=x,y=page.get_height()-top,width=right-x,height=top-y))
        assert len(rects)==6,(page_index,rects)
        for case,baseline,rect in zip(cases[page_index*6:page_index*6+6],baselines,sorted(rects,key=lambda r:r['y'])):
            facts=fonts[case['font']][int(case['bold'])+2*int(case['italic'])];scale=case['size']/facts['units']
            rows.append(dict(**case,baseline=baseline,rect=rect,offset=rect['y']-baseline,
                             postOffset=-facts['position']*scale,postThickness=facts['thickness']*scale))
    sha=lambda file:hashlib.sha256((ROOT/file).read_bytes()).hexdigest()
    (ROOT/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=sha('controls.docx'),pdfSha256=sha('native.pdf'),fonts=fonts,cases=rows),indent=2)+'\n')
    for family in FILES:
        subset=[r for r in rows if r['font']==family]
        print(family,'max post offset error',max(abs(r['offset']-r['postOffset']) for r in subset),'max thickness error',max(abs(r['rect']['height']-r['postThickness']) for r in subset))

    patterns=json.loads((ROOT/'patterns.json').read_text());pattern_doc=pdf.PdfDocument(ROOT/'patterns-native.pdf');assert len(pattern_doc)==2
    pattern_rows=[]
    for page_index,page in enumerate(pattern_doc):
        text=page.get_textpage();search=text.search('Underline sample');baselines=[]
        while (found:=search.get_next()) is not None:
            x,y=c.c_double(),c.c_double();pdf.raw.FPDFText_GetCharOrigin(text,found[0],c.byref(x),c.byref(y));baselines.append(page.get_height()-y.value)
        assert len(baselines)==len(patterns)
        rects=[]
        for obj in page.get_objects(max_depth=10):
            if obj.type!=pdf.raw.FPDF_PAGEOBJ_PATH:continue
            colors=[]
            for function in [pdf.raw.FPDFPageObj_GetFillColor,pdf.raw.FPDFPageObj_GetStrokeColor]:
                rgba=[c.c_uint() for _ in range(4)];function(obj,*[c.byref(v) for v in rgba]);colors.append([v.value for v in rgba])
            if any(r<2 and 120<g<135 and 120<b<135 and a==255 for r,g,b,a in colors):
                x,y,right,top=obj.get_bounds();rects.append(dict(x=x,y=page.get_height()-top,width=right-x,height=top-y))
        for name,baseline in zip(patterns,baselines):
            ink=[r for r in rects if -1<r['y']-baseline<12];assert ink,name
            pattern_rows.append(dict(page=page_index,pattern=name,baseline=baseline,top=min(r['y'] for r in ink),bottom=max(r['y']+r['height'] for r in ink),rects=ink))
    (ROOT/'pattern-reference.json').write_text(json.dumps(dict(sourceSha256=sha('patterns.docx'),pdfSha256=sha('patterns-native.pdf'),cases=pattern_rows),indent=2)+'\n')

if __name__=='__main__':record()
