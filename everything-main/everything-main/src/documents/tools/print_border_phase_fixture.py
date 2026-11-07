"""Author an independent physical-border control without the document engine."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json, hashlib
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/print-border-phase'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ET.register_namespace('w',W)
def node(parent,name,**attrs):
 return ET.SubElement(parent,'{'+W+'}'+name,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})
OUT.mkdir(parents=True,exist_ok=True)
with ZipFile(ROOT/'tests/fixtures/border-device-pixels/control-15.docx') as shell:
 source=ET.fromstring(shell.read('word/document.xml'))
 # The rewritten body contains standard WML only. ElementTree omits unused
 # prefix declarations, so do not retain a stale MCE Ignorable prefix list.
 source.attrib.clear()
 body=source.find('{'+W+'}body');section=body.find('{'+W+'}sectPr')
 body.clear()
 cases=[]
 for i,size in enumerate([2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,24]):
  indent=i%8; height=400+i%4
  cases.append(dict(index=i,sizeEighthPoints=size,indentTwips=indent,heightTwips=height))
  table=node(body,'tbl');pr=node(table,'tblPr')
  node(pr,'tblW',w=4320,type='dxa');node(pr,'jc',val='left');node(pr,'tblInd',w=indent,type='dxa')
  borders=node(pr,'tblBorders')
  for side in ['top','left','bottom','right']:node(borders,side,val='single',sz=size,color='6D7F91')
  node(pr,'tblLayout',type='fixed');margins=node(pr,'tblCellMar')
  for side in ['top','left','bottom','right']:node(margins,side,w=0,type='dxa')
  node(node(table,'tblGrid'),'gridCol',w=4320)
  row=node(table,'tr');node(node(row,'trPr'),'trHeight',val=height,hRule='exact')
  cell=node(row,'tc');cpr=node(cell,'tcPr');node(cpr,'tcW',w=4320,type='dxa');node(cpr,'shd',val='clear',fill='DDEEFF')
  for parent,line in [(cell,20),(body,120)]:
   p=node(parent,'p');ppr=node(p,'pPr');node(ppr,'spacing',before=0,after=0,line=line,lineRule='exact');node(node(ppr,'rPr'),'sz',val=2)
 body.append(section)
 data=ET.tostring(source,encoding='utf-8',xml_declaration=True)
 with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as target:
  for name in shell.namelist():target.writestr(name,data if name=='word/document.xml' else shell.read(name))
 (OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
 print(json.dumps(dict(cases=len(cases),sourceSha256=hashlib.sha256((OUT/'control.docx').read_bytes()).hexdigest())))
