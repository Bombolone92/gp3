"""Measure native marker gaps independently of browser layout."""
from pathlib import Path
import pypdfium2 as p
import hashlib,json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/inline-shape-frames'
cases=json.loads((root/'cases.json').read_text());result={}
for mode in [12,14,15]:
 rows=[]
 with p.PdfDocument(root/f'mode-{mode}-native.pdf') as doc:
  assert len(doc)==4
  for pageIndex,page in enumerate(doc):
   t=page.get_textpage();letters=[(t.get_text_range(i,1),list(t.get_charbox(i))) for i in range(t.count_chars()) if t.get_text_range(i,1) in ['A','B']]
   assert len(letters)==18
   initialGap=letters[1][1][0]-letters[0][1][2]
   for i,(a,b) in enumerate(zip(letters[::2],letters[1::2])):
    gap=b[1][0]-a[1][2]
    rows.append({**cases[pageIndex*9+i],'page':pageIndex,'gapPt':gap,'inlineAdvancePt':72+gap-initialGap,'beforeBounds':a[1],'afterBounds':b[1]})
 result[mode]={'referenceBuild':'16.0.20326','cases':rows,'hashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in [f'mode-{mode}.docx',f'mode-{mode}-native.pdf','cases.json']}}
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
for mode,data in result.items():print(mode,[(c['kind'],c['angle'],round(c['inlineAdvancePt'],3)) for c in data['cases']])
