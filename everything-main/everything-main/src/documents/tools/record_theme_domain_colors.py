"""Record native PDF vector colors for the original paired-domain control."""
from pathlib import Path
from hashlib import sha256
from pypdf import PdfReader
from pypdf.generic import ContentStream
import json,math
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/theme-domain-colors'
cases=json.loads((folder/'cases.json').read_text())
capture=json.loads((folder/'native-capture.json').read_text(encoding='utf-8-sig'))
assert capture['sourceUnchanged']
for name,key in [('control.docx','sourceSha256'),('native.pdf','pdfSha256')]:
    assert sha256((folder/name).read_bytes()).hexdigest()==capture[key]
pdf=PdfReader(folder/'native.pdf');assert len(pdf.pages)==2
import re
def mul(a,b):return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
def point(m,x,y):return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]
roles=['wml','drawingRgbFloor','drawingSchemeFloor','drawingRgbCeil'];rows=[]
for page_index,page in enumerate(pdf.pages):
    assert list(map(float,page.mediabox))==[0,0,612,792]
    labels=re.findall(r'\bC\d{3}\b',page.extract_text())
    assert labels==[c['label'] for c in cases[page_index*16:(page_index+1)*16]],labels
    groups={role:[] for role in roles};color=None;matrix=[1,0,0,1,0,0];stack=[];paths=[]
    for args,op in ContentStream(page.get_contents(),pdf).operations:
        if op==b'q':stack.append((matrix[:],color))
        elif op==b'Q':matrix,color=stack.pop()
        elif op==b'cm':matrix=mul(matrix,list(map(float,args)))
        elif op==b'rg':color=[math.floor(float(v)*255+.5) for v in args]
        elif op==b'g':color=[math.floor(float(args[0])*255+.5)]*3
        elif op==b're':
            x,y,w,h=map(float,args)
            paths.append([point(matrix,x,y),point(matrix,x+w,y),point(matrix,x+w,y+h),point(matrix,x,y+h)])
        elif op in [b'm',b'l',b'c']:paths.append(None)
        elif op in [b'f',b'f*',b'n',b'S',b'B',b'B*']:
            if op in [b'f',b'f*']:
                for path in paths:
                    if path is None:continue
                    x=min(p[0] for p in path);y=min(p[1] for p in path)
                    w=max(p[0] for p in path)-x;h=max(p[1] for p in path)-y
                    role=roles[0] if abs(x-108)<.1 and abs(w-72)<.1 and abs(h-24)<.1 else next((roles[i+1] for i in range(3) if abs(x-(180+72*i))<.1 and abs(w-40)<.1 and abs(h-16)<.1),None)
                    if role:
                        assert color is not None
                        assert all(abs(path[i][0]-path[(i+1)%4][0])<.001 or abs(path[i][1]-path[(i+1)%4][1])<.001 for i in range(4)),path
                        groups[role].append(dict(rgb=color[:],bounds=[x,792-y-h,w,h]))
            paths=[]
    for role in roles:
        groups[role].sort(key=lambda row:row['bounds'][1]);assert len(groups[role])==16,(role,len(groups[role]))
    for i,case in enumerate(cases[page_index*16:(page_index+1)*16]):
        top=groups['wml'][i]['bounds'][1]
        assert all(top-.1<=groups[role][i]['bounds'][1]<=top+8.1 for role in roles[1:])
        rows.append(dict(case,observed={role:groups[role][i] for role in roles}))
assert len(rows)==32
result=dict(capture=capture,casesSha256=sha256((folder/'cases.json').read_bytes()).hexdigest(),
            scope='Native PDF filled vector colors; no browser data or lossy screenshots',rows=rows,
            summary=dict(differentDomains=sum(r['observed']['wml']['rgb']!=r['observed']['drawingRgbFloor']['rgb'] for r in rows),
                         differentDrawingSources=sum(r['observed']['drawingRgbFloor']['rgb']!=r['observed']['drawingSchemeFloor']['rgb'] for r in rows),
                         differentPercentRounding=sum(r['observed']['drawingRgbFloor']['rgb']!=r['observed']['drawingRgbCeil']['rgb'] for r in rows)))
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result['summary']))
