"""Extract independent bar rectangles and tick strings from the reference PDF paths."""
from pathlib import Path
import ctypes as c
import hashlib, json, re, sys
import pypdfium2 as p

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures'/ (sys.argv[1] if len(sys.argv)>1 else 'stacked-charts')
result=[]
for pdf in sorted(folder.glob('*.pdf')):
    doc=p.PdfDocument(pdf); assert len(doc)==1
    page=doc[0]; rectangles=[]; stroke_colors=set()
    for i in range(p.raw.FPDFPage_CountObjects(page)):
        obj=p.raw.FPDFPage_GetObject(page,i)
        if p.raw.FPDFPageObj_GetType(obj)!=p.raw.FPDF_PAGEOBJ_PATH: continue
        fill_mode,stroke=c.c_int(),c.c_int()
        p.raw.FPDFPath_GetDrawMode(obj,c.byref(fill_mode),c.byref(stroke))
        def color(fn):
            values=[c.c_uint() for _ in range(4)]
            assert fn(obj,*[c.byref(v) for v in values])
            return [v.value for v in values]
        fill=color(p.raw.FPDFPageObj_GetFillColor); line=color(p.raw.FPDFPageObj_GetStrokeColor)
        if stroke.value and line[3]==255: stroke_colors.add('#'+''.join(f'{v:02x}' for v in line[:3]))
        matrix=p.raw.FS_MATRIX(); assert p.raw.FPDFPageObj_GetMatrix(obj,c.byref(matrix))
        points=[]
        for j in range(p.raw.FPDFPath_CountSegments(obj)):
            segment=p.raw.FPDFPath_GetPathSegment(obj,j); kind=p.raw.FPDFPathSegment_GetType(segment)
            x,y=c.c_float(),c.c_float();assert p.raw.FPDFPathSegment_GetPoint(segment,c.byref(x),c.byref(y))
            if kind==p.raw.FPDF_SEGMENT_MOVETO:points=[]
            assert kind in (p.raw.FPDF_SEGMENT_MOVETO,p.raw.FPDF_SEGMENT_LINETO)
            points.append((matrix.a*x.value+matrix.c*y.value+matrix.e,matrix.b*x.value+matrix.d*y.value+matrix.f))
            if p.raw.FPDFPathSegment_GetClose(segment) and len(points)>=4:
                xs,ys=zip(*points);x0,x1=min(xs),max(xs);y0,y1=min(ys),max(ys)
                if x1-x0>1 and y1-y0>1:
                    rectangles.append(dict(x=x0,y=page.get_height()-y1,w=x1-x0,h=y1-y0,fill=fill if fill_mode.value else None,line=line if stroke.value else None))
    plot=[r for r in rectangles if r['line']==[179,179,179,255] and r['w']>200 and r['h']>100]
    assert len(plot)==1;plot=plot[0]
    bars=[];outlines=[]
    for r in rectangles:
        if r['fill'] and r['fill'][3]==255:
            bars.append(dict(color='#'+''.join(f'{v:02x}' for v in r['fill'][:3]),x=(r['x']-plot['x'])/plot['w'],y=(r['y']-plot['y'])/plot['h'],w=r['w']/plot['w'],h=r['h']/plot['h']))
        if r['line'] and r['line'][3]==255 and r['w']<100:
            outlines.append(dict(color='#'+''.join(f'{v:02x}' for v in r['line'][:3]),x=(r['x']-plot['x'])/plot['w'],y=(r['y']-plot['y'])/plot['h'],w=r['w']/plot['w'],h=r['h']/plot['h']))
    ticks=[s for s in page.get_textpage().get_text_range().splitlines() if re.fullmatch(r'-?\d+%?',s)]
    assert len(ticks)>1
    source=root/f'public/fixtures/{pdf.stem}.docx'
    if not source.exists():source=folder/f'{pdf.stem}.docx'
    result.append(dict(name=pdf.stem,plot=plot,bars=bars,outlines=outlines,ticks=ticks,strokeColors=sorted(stroke_colors),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest()))
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
