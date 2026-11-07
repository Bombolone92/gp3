"""Independent OOXML list-marker alignment/tracking controls."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import argparse,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';N='{'+W+'}'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def generate(destination,mark_tracking=False):
 destination.mkdir(parents=True,exist_ok=True)
 with ZipFile(ROOT/'tests/fixtures/auto-line-spacing-rounding/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);body=xml.find(N+'body');sect=body.find(N+'sectPr');body.remove(sect);body.clear()
 numbering=E.Element(N+'numbering',nsmap={'w':W});cases=[]
 def props(parent,family,size,tracking):
  E.SubElement(parent,N+'rFonts',{N+'ascii':family,N+'hAnsi':family})
  if tracking is not None:E.SubElement(parent,N+'spacing',{N+'val':str(round(tracking*20))})
  E.SubElement(parent,N+'sz',{N+'val':str(size*2)})
 for family in ['Arial','Trebuchet MS','Times New Roman','Garamond']:
  for alignment in ['left','center','right']:
   for tracking in [0,.75,-.5]:
    for label in ['8','88','8.']:
     index=len(cases);abstract=E.SubElement(numbering,N+'abstractNum',{N+'abstractNumId':str(index)})
     level=E.SubElement(abstract,N+'lvl',{N+'ilvl':'0'})
     E.SubElement(level,N+'start',{N+'val':'88' if label=='88' else '8'})
     E.SubElement(level,N+'numFmt',{N+'val':'decimal'})
     E.SubElement(level,N+'suff',{N+'val':'nothing'})
     E.SubElement(level,N+'lvlText',{N+'val':'%1.' if label=='8.' else '%1'})
     E.SubElement(level,N+'lvlJc',{N+'val':alignment})
     lp=E.SubElement(level,N+'pPr');E.SubElement(lp,N+'ind',{N+'left':'1440',N+'hanging':'720'})
     props(E.SubElement(level,N+'rPr'),family,12,None if mark_tracking else tracking)
     p=E.SubElement(body,N+'p');pr=E.SubElement(p,N+'pPr')
     if index and index%9==0:E.SubElement(pr,N+'pageBreakBefore')
     np=E.SubElement(pr,N+'numPr');E.SubElement(np,N+'ilvl',{N+'val':'0'});E.SubElement(np,N+'numId',{N+'val':str(index+1)})
     E.SubElement(pr,N+'spacing',{N+'before':'0',N+'after':'240',N+'line':'360',N+'lineRule':'atLeast'})
     props(E.SubElement(pr,N+'rPr'),'Arial',12,tracking if mark_tracking else 0)
     r=E.SubElement(p,N+'r');props(E.SubElement(r,N+'rPr'),'Arial',12,0);E.SubElement(r,N+'t').text=f'Case {index:03}'
     cases.append(dict(index=index,page=index//9,family=family,alignment=alignment,trackingPt=tracking,label=label,text=f'Case {index:03}'))
 for case in cases:
  num=E.SubElement(numbering,N+'num',{N+'numId':str(case['index']+1)});E.SubElement(num,N+'abstractNumId',{N+'val':str(case['index'])})
 body.append(sect)
 parts['word/document.xml']=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
 parts['word/numbering.xml']=E.tostring(numbering,xml_declaration=True,encoding='UTF-8',standalone=True)
 rel=E.fromstring(parts['word/_rels/document.xml.rels'])
 if not any(e.get('Type')==R+'/numbering' for e in rel):E.SubElement(rel,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='metricNumbering',Type=R+'/numbering',Target='numbering.xml')
 parts['word/_rels/document.xml.rels']=E.tostring(rel,xml_declaration=True,encoding='UTF-8')
 ct=E.fromstring(parts['[Content_Types].xml'])
 if not any(e.get('PartName')=='/word/numbering.xml' for e in ct):E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/numbering.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml')
 parts['[Content_Types].xml']=E.tostring(ct,xml_declaration=True,encoding='UTF-8')
 with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():entry=ZipInfo(name,(2020,1,1,0,0,0));entry.compress_type=ZIP_DEFLATED;z.writestr(entry,data)
 (destination/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
 print(hashlib.sha256((destination/'control.docx').read_bytes()).hexdigest())

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('destination',type=Path);p.add_argument('--mark-tracking',action='store_true');a=p.parse_args();generate(a.destination,a.mark_tracking)
