"""Independent controls for a small paragraph below a nearly full-page table."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
from canvas_group_fixture import NS, tag, add
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/bottom-line-boundary';folder.mkdir(parents=True,exist_ok=True)
W=NS['w'];R='http://schemas.openxmlformats.org/package/2006/relationships';C='http://schemas.openxmlformats.org/package/2006/content-types'
doc=E.Element(tag('w:document'),nsmap={'w':W});body=add(doc,'w:body')
def section(parent):
 sec=add(parent,'w:sectPr');add(sec,'w:pgSz',**{'w:w':15840,'w:h':12240,'w:orient':'landscape'});add(sec,'w:pgMar',**{'w:top':357,'w:right':357,'w:bottom':284,'w:left':357,'w:header':0,'w:footer':0,'w:gutter':0});return sec
cases=[]
specs=[('auto',276,[50,55,56,57,60,64,65,66,67,68,69,70,78,79,80]),('auto',480,[68,69,70]),('auto',120,[34,35,68,69,70]),('exact',79,[78,79,80]),('atLeast',79,[78,79,80])]
for rule,space,remainders in specs:
 for remainder,visible in [(r,v) for r in remainders for v in (False,True)]:
  ident=len(cases)+1;name=f'Case {ident:02d} {rule} {space} remaining {remainder} '+('text' if visible else 'empty')
  table=add(body,'w:tbl');pr=add(table,'w:tblPr');add(pr,'w:tblW',**{'w:w':15126,'w:type':'dxa'});add(pr,'w:tblLayout',**{'w:type':'fixed'})
  mar=add(pr,'w:tblCellMar')
  for side in ['top','left','bottom','right']:add(mar,'w:'+side,**{'w:w':0,'w:type':'dxa'})
  add(add(table,'w:tblGrid'),'w:gridCol',**{'w:w':15126});row=add(table,'w:tr');add(add(row,'w:trPr'),'w:trHeight',**{'w:val':11599-remainder,'w:hRule':'atLeast'})
  cell=add(row,'w:tc');add(add(cell,'w:tcPr'),'w:tcW',**{'w:w':15126,'w:type':'dxa'})
  p=add(cell,'w:p');r=add(p,'w:r');add(add(r,'w:rPr'),'w:sz',**{'w:val':20});add(r,'w:t',text=name)
  p=add(body,'w:p');pr=add(p,'w:pPr');add(pr,'w:spacing',**{'w:line':space,'w:lineRule':rule});add(add(pr,'w:rPr'),'w:sz',**{'w:val':6})
  if visible:
   r=add(p,'w:r');add(add(r,'w:rPr'),'w:sz',**{'w:val':6});add(r,'w:t',text='x')
  p=add(body,'w:p');pr=add(p,'w:pPr');add(add(pr,'w:rPr'),'w:sz',**{'w:val':6});section(pr)
  cases.append(dict(id=ident,name=name,rule=rule,spacing=space,remainderTwips=remainder,visible=visible))
add(add(add(body,'w:p'),'w:r'),'w:t',text='End of controls');section(body)
styles=E.Element(tag('w:styles'),nsmap={'w':W});defaults=add(styles,'w:docDefaults');rp=add(add(defaults,'w:rPrDefault'),'w:rPr');add(rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial','w:cs':'Arial','w:eastAsia':'Arial'});add(rp,'w:b');add(rp,'w:sz',**{'w:val':32});add(rp,'w:szCs',**{'w:val':32});add(add(add(defaults,'w:pPrDefault'),'w:pPr'),'w:spacing',**{'w:line':276,'w:lineRule':'auto'});normal=add(styles,'w:style',**{'w:type':'paragraph','w:default':1,'w:styleId':'Normal'});add(normal,'w:name',**{'w:val':'Normal'})
settings=E.Element(tag('w:settings'),nsmap={'w':W});add(add(settings,'w:compat'),'w:compatSetting',**{'w:name':'compatibilityMode','w:uri':'http://schemas.microsoft.com/office/word','w:val':15})
ct=E.Element('{'+C+'}Types',nsmap={None:C})
for ext,typ in [('rels','application/vnd.openxmlformats-package.relationships+xml'),('xml','application/xml')]:E.SubElement(ct,'{'+C+'}Default',Extension=ext,ContentType=typ)
for name,typ in [('document','document.main'),('styles','styles'),('settings','settings')]:E.SubElement(ct,'{'+C+'}Override',PartName=f'/word/{name}.xml',ContentType=f'application/vnd.openxmlformats-officedocument.wordprocessingml.{typ}+xml')
rels=E.Element('{'+R+'}Relationships',nsmap={None:R});E.SubElement(rels,'{'+R+'}Relationship',Id='rId1',Type=NS['r']+'/officeDocument',Target='word/document.xml')
dr=E.Element('{'+R+'}Relationships',nsmap={None:R})
for i,name in enumerate(['styles','settings']):E.SubElement(dr,'{'+R+'}Relationship',Id=f'rId{i+1}',Type=NS['r']+'/'+name,Target=name+'.xml')
parts={'[Content_Types].xml':ct,'_rels/.rels':rels,'word/_rels/document.xml.rels':dr,'word/document.xml':doc,'word/styles.xml':styles,'word/settings.xml':settings}
target=root/'public/fixtures/bottom-line-boundary.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
 for name,node in parts.items():z.writestr(name,E.tostring(node,xml_declaration=True,encoding='UTF-8',standalone=True))
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8');print(target)
