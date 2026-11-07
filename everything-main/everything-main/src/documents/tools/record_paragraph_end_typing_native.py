"""Record owned native reference XML declarations, without loading font programs."""
from pathlib import Path
from zipfile import ZipFile
import argparse,hashlib,json,xml.etree.ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def record(path):
 data=path.read_bytes()
 with ZipFile(path) as z:root=ET.fromstring(z.read('word/document.xml'))
 def props(node):return {} if node is None else {n.tag.removeprefix(W):n.get(W+'val','1') for n in node}
 table_paragraphs={id(p) for tc in root.iter(W+'tc') for p in tc.iter(W+'p')}
 return {'sha256':hashlib.sha256(data).hexdigest(),'paragraphs':[{'text':''.join(t.text or '' for t in p.iter(W+'t')),'inTable':id(p) in table_paragraphs,'mark':props(p.find(W+'pPr/'+W+'rPr')),'runs':[{'text':''.join(t.text or '' for t in r.iter(W+'t')),'properties':props(r.find(W+'rPr'))} for r in p.findall(W+'r')]} for p in root.iter(W+'p')]}
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--native-dir',type=Path,required=True);args=a.parse_args()
 folder=Path('tests/fixtures/paragraph-end-typing')
 cases=[]
 for name,stages in [('body',{'after':'body-owned.docx'}),('toggle-cell',{'beforeEnter':'toggle-cell-before-enter.docx','after':'toggle-cell-exact-owned.docx'}),('toggle-body',{'beforeEnter':'toggle-body-before-enter.docx','after':'toggle-body-owned.docx'}),('partial-body',{'afterFormat':'partial-body-owned.docx'})]:
  source=folder/(name+'.docx');cases.append({'fixture':name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),**{key:record(args.native_dir/file) for key,file in stages.items()}})
 result={'referenceBuild':'16.0.20430.20140','method':'Visible owned copies opened with the reference-application helper. Native keyboard selection (eleven Shift+Right characters), Ctrl+B, Ctrl+S to capture mark declarations before Enter, then collapse with Right, Enter and literal text insertion. Partial-body first moves Right seven times. The direct-format body uses Ctrl+End, Enter and text insertion. Source fixtures unchanged. XML declarations only; no font programs read.','cases':cases}
 (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
