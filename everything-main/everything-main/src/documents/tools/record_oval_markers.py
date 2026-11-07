"""Measure native PDF ink for independently authored oval-marker controls."""
from pathlib import Path
from hashlib import sha256
import json
import pypdfium2 as pdfium
from PIL import Image, ImageChops
from pypdf import PdfReader
from pypdf.generic import ContentStream
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/oval-markers'
source=folder/'control.docx';pdf=folder/'native.pdf'
doc=pdfium.PdfDocument(pdf)
assert len(doc)==2
images=[page.render(scale=4).to_pil().convert('RGB') for page in doc]
cases=json.loads((folder/'cases.json').read_text())
reader=PdfReader(pdf)
for i,page in enumerate(reader.pages):
    height=float(page.mediabox.height);color=(0,0,0);stack=[];commands=[];subpaths=[]
    for args,op in ContentStream(page.get_contents(),reader).operations:
        if op==b'q':stack.append(color)
        elif op==b'Q':color=stack.pop()
        elif op==b'cm':raise ValueError('Extend recorder for transformed PDF coordinates')
        elif op==b'rg':color=tuple(float(v)*255 for v in args)
        elif op==b'g':color=(float(args[0])*255,)*3
        elif op==b'm':
            if commands:subpaths.append(commands)
            commands=[('m',[float(args[0]),height-float(args[1])])]
        elif op==b'c':commands.append(('c',[float(args[-2]),height-float(args[-1])]))
        elif op==b'l':commands.append(('l',[]))
        elif op in [b'f',b'f*']:
            subpaths.append(commands)
            for commands in subpaths:
              if len(commands)==5 and [c[0] for c in commands]==['m','c','c','c','c']:
                matches=[c for c in cases if c['page']==i and max(abs(int(c['color'][j*2:j*2+2],16)-color[j]) for j in range(3))<1]
                if matches:
                    assert len(matches)==1
                    p0,p1,p2=[c[1] for c in commands[:3]]
                    center=[(p0[j]+p2[j])/2 for j in range(2)]
                    u=[p0[j]-center[j] for j in range(2)];v=[p1[j]-center[j] for j in range(2)]
                    matches[0].setdefault('markers',[]).append(dict(center=center,u=u,v=v))
            commands=[];subpaths=[]
        elif op in [b'S',b's',b'n']:commands=[];subpaths=[]
for c in cases:
    assert len(c.get('markers',[])) == (0 if c['name']=='closed' else 2 if c['name'] in ['curve','curve-wide','diagonal'] else 1),c['name']
for case in cases:
    image=images[case['page']]
    rgb=tuple(int(case['color'][i:i+2],16) for i in [0,2,4])
    if case.get('opacity'):rgb=tuple(round(v*case['opacity']+255*(1-case['opacity'])) for v in rgb)
    diff=ImageChops.difference(image,Image.new('RGB',image.size,rgb))
    r,g,b=diff.split()
    mask=ImageChops.lighter(ImageChops.lighter(r,g),b).point(lambda v:255 if v<2 else 0)
    box=mask.getbbox()
    assert box,case['name']
    case['ink']={k:v/4 for k,v in zip(['left','top','right','bottom'],box)}
    if case['name'] in ['alpha','dashed']:
        case['samples']=[dict(x=case['x']+dx,y=case['y'],rgb=image.getpixel((round((case['x']+dx)*4),round(case['y']*4)))) for dx in [2,10,107,108]]
record=dict(sourceSha256=sha256(source.read_bytes()).hexdigest(),pdfSha256=sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',cases=cases)
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
for i,image in enumerate(images):image.resize((816,1056),Image.Resampling.BOX).save(folder/f'native-{i+1}.png')
print(json.dumps(cases,indent=2))
