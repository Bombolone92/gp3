"""Fresh-page controls: automatic advance can exceed the writing-area height."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
from canvas_group_fixture import NS,tag,add
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/bottom-line-fresh';folder.mkdir(parents=True,exist_ok=True)
with ZipFile(root/'public/fixtures/bottom-line-boundary.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.Element(tag('w:document'),nsmap={'w':NS['w']});body=add(doc,'w:body');cases=[]
specs=[('auto',480,1660),('auto',1200,1660),('auto',120,1000),('exact',1660,1660),('atLeast',1660,1660)]
def section(parent,space):
 sec=add(parent,'w:sectPr');add(sec,'w:pgSz',**{'w:w':15840,'w:h':12240,'w:orient':'landscape'});add(sec,'w:pgMar',**{'w:top':357,'w:right':357,'w:bottom':12240-357-space,'w:left':357,'w:header':0,'w:footer':0,'w:gutter':0})
for i,(rule,spacing,space) in enumerate(specs):
 text=chr(65+i);p=add(body,'w:p');pr=add(p,'w:pPr');add(pr,'w:spacing',**{'w:line':spacing,'w:lineRule':rule});add(add(pr,'w:rPr'),'w:sz',**{'w:val':144})
 r=add(p,'w:r');add(add(r,'w:rPr'),'w:sz',**{'w:val':144});add(r,'w:t',text=text)
 if i<len(specs)-1:
  p=add(body,'w:p');pr=add(p,'w:pPr');add(add(pr,'w:rPr'),'w:sz',**{'w:val':6});section(pr,space)
 else:section(body,space)
 cases.append(dict(text=text,rule=rule,spacing=spacing,spaceTwips=space))
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'public/fixtures/bottom-line-fresh.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
