"""Read reference PDF border rectangles and cell text origins, without engine data."""
import json
import hashlib
from pathlib import Path
from pypdf import PdfReader
from canvas_conditional_border_fixture import CASES, COLORS

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/conditional-table-borders'
pages=PdfReader(folder/'native.pdf').pages
assert len(pages)==len(CASES)
result={}
for (name,_,_),page in zip(CASES,pages):
    state={'color':'000000'}; stack=[]; path=[]; rectangles=[]; lines=[]
    def operand(op,args,cm,tm):
        if op==b'q':stack.append(dict(state))
        elif op==b'Q':state.update(stack.pop())
        elif op==b'rg':state['color']=''.join(f'{round(float(x)*255):02X}' for x in args)
        elif op==b'g':state['color']=f'{round(float(args[0])*255):02X}'*3
        elif op==b're':
            x,y,w,h=map(float,args); points=[(a*cm[0]+b*cm[2]+cm[4],float(page.mediabox.top)-(a*cm[1]+b*cm[3]+cm[5])) for a,b in [(x,y),(x+w,y),(x,y+h),(x+w,y+h)]]
            path.append({'left':min(p[0] for p in points),'right':max(p[0] for p in points),'top':min(p[1] for p in points),'bottom':max(p[1] for p in points)})
        elif op in [b'f',b'f*',b'F']:
            if state['color'] in COLORS.values():rectangles.extend({**r,'color':state['color']} for r in path)
            path.clear()
        elif op in [b'n',b'S',b's']:path.clear()
    def text(value,cm,tm,font,size):
        value=value.strip()
        if len(value)==4 and value[0]=='R' and value[2]=='C':lines.append({'text':value,'x':tm[4]*cm[0]+tm[5]*cm[2]+cm[4],'y':float(page.mediabox.top)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]),'size':size})
    page.extract_text(visitor_operand_before=operand,visitor_text=text)
    assert len(lines)==16 and rectangles,(name,len(lines),len(rectangles))
    result[name]={'lines':lines,'rectangles':rectangles}
    print(name,len(rectangles),'painted rectangles')
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
paths=[root/'public/fixtures/conditional-table-borders.docx',folder/'native.pdf']
(folder/'manifest.json').write_text(json.dumps({p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},indent=2)+'\n',encoding='utf-8')
