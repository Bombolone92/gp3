"""Record script sizes and offsets from the independent native PDF."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json,struct
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/script-size'
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
files={'Garamond':['gara.ttf','garabd.ttf','garait.ttf'],'Arial':['arial.ttf','arialbd.ttf','ariali.ttf'],'Times New Roman':['times.ttf','timesbd.ttf','timesi.ttf']}
identities={'Garamond':['Garamond','Garamond-Bold','Garamond-Italic'],'Arial':['ArialMT','Arial-BoldMT','Arial-ItalicMT'],'Times New Roman':['TimesNewRomanPSMT','TimesNewRomanPS-BoldMT','TimesNewRomanPS-ItalicMT']}
fonts={}
for family,names in files.items():
    fonts[family]=[]
    for name in names:
        data=(Path('C:/Windows/Fonts')/name).read_bytes()
        tables={data[12+i*16:16+i*16].decode():offset for i in range(struct.unpack_from('>H',data,4)[0]) for offset in [struct.unpack_from('>I',data,20+i*16)[0]]}
        fonts[family].append(dict(file=name,sha256=hashlib.sha256(data).hexdigest(),unitsPerEm=struct.unpack_from('>H',data,tables['head']+18)[0],os2ScriptMetrics=list(struct.unpack_from('>8h',data,tables['OS/2']+10))))
reader=PdfReader(folder/'native.pdf');assert len(reader.pages)==len(cases)
for case,page in zip(cases,reader.pages):
    runs=[]
    def visit(text,ctm,matrix,font,size):
        if text.strip() in ['START','TEST','END']:
            assert ctm[:4]==[1,0,0,1] and matrix[:4]==[1,0,0,1],(ctm,matrix)
            expected=identities[case['family']][['regular','bold','italic'].index(case['face'])]
            assert str(font['/BaseFont']).split('+')[-1]==expected,(font['/BaseFont'],expected)
            runs.append(dict(text=text.strip(),font=str(font['/BaseFont']),size=size,x=matrix[4],y=matrix[5]))
    page.extract_text(visitor_text=visit)
    assert len(runs)==len(case['rows'])*3,(case,len(runs))
    for i,row in enumerate(case['rows']):
        start,script,end=runs[i*3:i*3+3]
        row.update(nativeSize=script['size'],rise=script['y']-start['y'],scriptX=script['x'],followingX=end['x'],font=script['font'])
    print(case['family'],case['face'],[(r['size'],r['script'],r['nativeSize'],round(r['rise'],3)) for r in case['rows']])
record=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),fonts=fonts,cases=cases)
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
