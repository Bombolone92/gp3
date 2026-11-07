"""Record native page allocation for the independently authored boundary cases."""
from pathlib import Path
import hashlib,json,re
import pypdfium2 as pdf
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/bottom-line-boundary'
cases=json.loads((folder/'cases.json').read_text());doc=pdf.PdfDocument(folder/'reference.pdf')
starts={};visible={};current=None;end=None
for i in range(len(doc)):
 page=doc[i];textPage=page.get_textpage();text=textPage.get_text_range();match=re.search(r'Case (\d+)',text)
 if match:current=int(match[1]);starts[current]=i
 if re.search(r'(^|[\r\n])x($|[\r\n])',text):
  if current in visible:raise ValueError('Duplicate visible control glyph')
  visible[current]=i
 if 'End of controls' in text:end=i
 textPage.close();page.close()
assert len(starts)==len(cases) and end is not None
for case in cases:
 ident=case['id'];case['page']=starts[ident];case['nextPage']=starts.get(ident+1,end);case['overflowPages']=case['nextPage']-case['page']-1
 if case['visible']:
  assert ident in visible;case['textPage']=visible[ident]
paths=[root/'public/fixtures/bottom-line-boundary.docx',folder/'reference.pdf']
result=dict(referenceBuild='16.0.20326',pageCount=len(doc),endPage=end,cases=cases,hashes={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');doc.close()
print('Recorded',len(cases),'cases and',result['pageCount'],'native pages')
