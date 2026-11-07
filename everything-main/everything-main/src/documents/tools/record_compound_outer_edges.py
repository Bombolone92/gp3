"""Record native colored border rectangles and text origins, without engine code."""
from pathlib import Path
from collections import defaultdict
import ctypes,hashlib,json
import pypdfium2 as pdf

root=Path(__file__).resolve().parents[1]/'tests/fixtures/compound-outer-edges'
for mode in [12,15]:
    folder=root/f'mode{mode}';cases=json.loads((folder/'cases.json').read_text(encoding='utf8'))
    document=pdf.PdfDocument(folder/'native.pdf');assert len(document)==len(cases)
    for case,page in zip(cases,document):
        boxes=[]
        for obj in page.get_objects():
            if obj.type!=pdf.raw.FPDF_PAGEOBJ_PATH:continue
            rgba=[ctypes.c_uint() for _ in range(4)]
            assert pdf.raw.FPDFPageObj_GetFillColor(obj.raw,*(ctypes.byref(c) for c in rgba))
            color=[c.value for c in rgba]
            assert color[:3] in [[204,0,0],[0,136,0],[0,0,204],[170,0,170]]
            x0,y0,x1,y1=obj.get_bounds();assert pdf.raw.FPDFPath_CountSegments(obj.raw)==5
            points=[]
            for i in range(5):
                segment=pdf.raw.FPDFPath_GetPathSegment(obj.raw,i);x,y=ctypes.c_float(),ctypes.c_float()
                assert pdf.raw.FPDFPathSegment_GetPoint(segment,ctypes.byref(x),ctypes.byref(y))
                assert min(abs(x.value-x0),abs(x.value-x1))<.001 and min(abs(y.value-y0),abs(y.value-y1))<.001
                points.append((round(x.value,3),round(y.value,3)))
            assert len(set(points))==4
            boxes.append([x0,page.get_height()-y1,x1-x0,y1-y0,''.join(f'{v:02X}' for v in color[:3])])
        assert len(boxes)>=16
        lines=defaultdict(list);text=page.get_textpage()
        for i in range(text.count_chars()):
            char=text.get_text_range(i,1)
            if not char.strip():continue
            x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y))
            lines[round(page.get_height()-y.value,4)].append(char)
        case['boxes']=boxes;case['lines']=[dict(text=''.join(chars),y=y) for y,chars in lines.items()]
    result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=cases)
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print('Recorded',mode,len(cases),'pages')
