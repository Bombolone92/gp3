"""Record native PDF line endpoints and following-text baselines, not app data."""
from pathlib import Path
import hashlib,json
from pypdf import PdfReader

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/flat-line-baseline'
cases=json.loads((folder/'cases.json').read_text())
for mode in [12,15]:
    source=folder/f'mode-{mode}.docx';pdf=folder/f'mode-{mode}.pdf'
    reader=PdfReader(pdf);assert len(reader.pages)==len(cases)
    records=[]
    for index,page in enumerate(reader.pages):
        state={'color':None,'points':[]};lines=[];following=[]
        height=float(page.mediabox.height)
        def visit(op,args,cm,tm):
            if op==b'RG':state['color']=[float(v) for v in args]
            if op in [b'm',b'l'] and state['color'] and state['color'][0]>.7 and state['color'][1]<.2:
                x,y=map(float,args)
                point=[x*cm[0]+y*cm[2]+cm[4],height-(x*cm[1]+y*cm[3]+cm[5])]
                if op==b'm':state['points']=[point]
                else:state['points'].append(point)
            if op==b'S' and len(state['points'])==2:
                lines.append(state['points']);state['points']=[]
        def text(s,cm,tm,font,size):
            if s.startswith('After '):following.append(height-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]))
        page.extract_text(visitor_operand_before=visit,visitor_text=text)
        assert len(lines)==1,(mode,index,lines)
        assert len(following)==1,(mode,index,following)
        a,b=lines[0]
        records.append(dict(name=cases[index]['name'],page=index,x=a[0],top=min(a[1],b[1]),bottom=max(a[1],b[1]),afterBaseline=following[0]))
    result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=records)
    (folder/f'mode-{mode}-reference.json').write_text(json.dumps(result,indent=2)+'\n')
    for c in records:print(mode,c)
