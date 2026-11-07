"""Independently record reference glyph origins and green side-border rectangles."""
from pathlib import Path
import json
import subprocess
import sys
from pypdf import PdfReader

root=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(root/'tools/reviewed_font_reference.py'),'first-row-table-inset'],check=True)
folder=root/'tests/fixtures/first-row-table-inset'
reference=json.loads((folder/'reference.json').read_text())
page=PdfReader(folder/'native.pdf').pages[0]
state={'color':None};stack=[];path=[];rectangles=[]
def operand(op,args,cm,tm):
    if op==b'q':stack.append(state.copy())
    elif op==b'Q':state.update(stack.pop())
    elif op==b'rg':state['color']=tuple(round(float(x)*255) for x in args)
    elif op==b'g':state['color']=(round(float(args[0])*255),)*3
    elif op==b're':
        x,y,w,h=map(float,args)
        points=[(a*cm[0]+b*cm[2]+cm[4],float(page.mediabox.top)-(a*cm[1]+b*cm[3]+cm[5])) for a,b in [(x,y),(x+w,y),(x,y+h),(x+w,y+h)]]
        path.append(dict(x=min(p[0] for p in points),y=min(p[1] for p in points),width=max(p[0] for p in points)-min(p[0] for p in points),height=max(p[1] for p in points)-min(p[1] for p in points)))
    elif op in [b'f',b'f*',b'F']:
        if state['color']==(0,128,0):rectangles.extend(path)
        path.clear()
    elif op in [b'n',b'S',b's']:path.clear()
page.extract_text(visitor_operand_before=operand)
assert len(rectangles)==20
reference['borders']=sorted(rectangles,key=lambda r:(r['y'],r['x']))
(folder/'reference.json').write_text(json.dumps(reference,indent=2)+'\n')
