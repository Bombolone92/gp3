"""Record native vector rectangle positions for signed offset controls."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from shutil import copyfile
from pypdf import PdfReader
from pypdf.generic import ContentStream
import json,sys,math
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/anchor-offset-precision';work=Path(sys.argv[1])
result={}
for name,native in [('control','anchor-offset-precision'),('containers','anchor-offset-containers')]:
    source=out/(name+'.docx')
    with ZipFile(source) as a,ZipFile(work/(native+'.docx')) as b:
        assert set(a.namelist())==set(b.namelist()) and all(a.read(n)==b.read(n) for n in a.namelist())
    pdf=work/(native+'.pdf');r=PdfReader(pdf);assert len(r.pages)==4;rects=[]
    for page,p in enumerate(r.pages):
        found=[];rect=None
        for args,op in ContentStream(p.get_contents(),r).operations:
            assert op!=b'cm','Unexpected transform'
            if op==b're':rect=list(map(float,args))
            elif op==b'S' and rect and abs(rect[2]-24)<1e-6 and abs(rect[3]-18)<1e-6:
                found.append(dict(page=page,leftPt=rect[0],topPt=float(p.mediabox.height)-rect[1]-rect[3],widthPt=rect[2],heightPt=rect[3]));rect=None
        assert len(found)==16,(page,len(found));rects.extend(found)
    cases=json.loads((out/('cases.json' if name=='control' else 'containers-cases.json')).read_text())
    for case,rect in zip(cases,rects):
        xbase=0 if case['page']==0 else 96
        ybase=xbase+(1 if name=='containers' and case['page']>=2 else 0)
        assert abs(rect['leftPt']-xbase-math.trunc(case['xEmu']/635)/20)<1e-6,(case,rect)
        assert abs(rect['topPt']-ybase-math.trunc(case['yEmu']/635)/20)<1e-6,(case,rect)
    copyfile(pdf,out/(name+'-native.pdf'))
    result[name]=dict(sourceSha256=sha256(source.read_bytes()).hexdigest(),pdfSha256=sha256(pdf.read_bytes()).hexdigest(),rectangles=rects)
(out/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print('128 native rectangles match signed whole-twip truncation.')
