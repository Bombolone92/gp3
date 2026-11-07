"""Record native reference chart frames, plot rectangles and axis text positions."""
from pathlib import Path
import ctypes as C
import hashlib
import json
import argparse
import pypdfium2 as P
from pypdf import PdfReader

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--folder', type=Path, default=Path(__file__).resolve().parents[1] / 'tests/fixtures/column-chart-legends')
folder = parser.parse_args().folder
records = []
for pdf in sorted(folder.glob('*.pdf')):
    doc = P.PdfDocument(pdf)
    assert len(doc) == 1
    page = doc[0]
    rectangles = []
    for i in range(P.raw.FPDFPage_CountObjects(page)):
        obj = P.raw.FPDFPage_GetObject(page, i)
        if P.raw.FPDFPageObj_GetType(obj) != P.raw.FPDF_PAGEOBJ_PATH: continue
        fill_mode, stroke = C.c_int(), C.c_int()
        P.raw.FPDFPath_GetDrawMode(obj, C.byref(fill_mode), C.byref(stroke))
        if not stroke.value: continue
        color = [C.c_uint() for _ in range(4)]
        assert P.raw.FPDFPageObj_GetStrokeColor(obj, *[C.byref(v) for v in color])
        rgb = '#'+''.join(f'{v.value:02x}' for v in color[:3])
        if rgb not in ['#ff00ff', '#b3b3b3']: continue
        matrix = P.raw.FS_MATRIX()
        assert P.raw.FPDFPageObj_GetMatrix(obj, C.byref(matrix))
        points = []
        for j in range(P.raw.FPDFPath_CountSegments(obj)):
            segment = P.raw.FPDFPath_GetPathSegment(obj, j)
            kind = P.raw.FPDFPathSegment_GetType(segment)
            x, y = C.c_float(), C.c_float()
            assert P.raw.FPDFPathSegment_GetPoint(segment, C.byref(x), C.byref(y))
            if kind == P.raw.FPDF_SEGMENT_MOVETO: points = []
            assert kind in (P.raw.FPDF_SEGMENT_MOVETO, P.raw.FPDF_SEGMENT_LINETO)
            points.append((matrix.a*x.value+matrix.c*y.value+matrix.e, matrix.b*x.value+matrix.d*y.value+matrix.f))
            if P.raw.FPDFPathSegment_GetClose(segment) and len(points) >= 4:
                xs, ys = zip(*points)
                if max(xs)-min(xs) > 50 and max(ys)-min(ys) > 20:
                    rectangles.append(dict(color=rgb, x=min(xs), y=page.get_height()-max(ys), width=max(xs)-min(xs), height=max(ys)-min(ys)))
    frame, = [r for r in rectangles if r['color'] == '#ff00ff']
    plot, = [r for r in rectangles if r['color'] == '#b3b3b3']
    labels = []
    def text(value, cm, tm, font, size):
        if not value.strip(): return
        labels.append(dict(text=value.strip(), x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4], baseline=page.get_height()-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]), font=str(font.get('/BaseFont')) if font else None, size=size))
    PdfReader(pdf).pages[0].extract_text(visitor_text=text)
    keys = []
    for obj in page.get_objects():
        if obj.type != P.raw.FPDF_PAGEOBJ_PATH: continue
        rgba = [C.c_uint() for _ in range(4)]
        if not P.raw.FPDFPageObj_GetFillColor(obj.raw, *[C.byref(v) for v in rgba]): continue
        mode, stroked = C.c_int(), C.c_int()
        P.raw.FPDFPath_GetDrawMode(obj.raw, C.byref(mode), C.byref(stroked))
        if not mode.value: continue
        l,b,r,t = obj.get_bounds(); y = page.get_height()-t
        if y > plot['y']+plot['height'] and 1 < r-l < 30 and 1 < t-b < 30:
            keys.append(dict(color='#'+''.join(f'{v.value:02x}' for v in rgba[:3]), x=l, y=y, width=r-l, height=t-b))
    source = pdf.with_suffix('.docx')
    records.append(dict(name=pdf.stem, frame=frame, plot=plot, labels=labels, keys=keys, sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest()))
(folder/'reference.json').write_text(json.dumps(records, indent=2)+'\n', encoding='utf-8')
