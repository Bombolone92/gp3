"""Original first-baseline controls, authored without viewer measurements."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import json, hashlib

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'tests/fixtures/first-baseline-rounding'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';N='{'+W+'}'


def generate(destination=DEST):
 destination.mkdir(parents=True,exist_ok=True)
 # This existing original control supplies only an OPC/styles/settings shell.
 with ZipFile(ROOT/'tests/fixtures/auto-line-spacing-rounding/control.docx') as z:
  parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);body=xml.find(N+'body');sect=body.find(N+'sectPr');body.remove(sect);body.clear()
 cases=[]
 for family in ['Arial','Trebuchet MS','Times New Roman','Garamond']:
  for size in [11,12,17,28,38,60]:
   for multiple in [240,259,276]:
    for face in ['regular','bold','italic','bold-italic']:
     p=E.SubElement(body,N+'p');pr=E.SubElement(p,N+'pPr')
     if cases:E.SubElement(pr,N+'pageBreakBefore')
     E.SubElement(pr,N+'spacing',{N+'before':'0',N+'after':'0',N+'line':str(multiple),N+'lineRule':'auto'})
     mark=E.SubElement(pr,N+'rPr');run=E.SubElement(p,N+'r');rp=E.SubElement(run,N+'rPr')
     for props in (mark,rp):
      E.SubElement(props,N+'rFonts',{N+'ascii':family,N+'hAnsi':family})
      if 'bold' in face:E.SubElement(props,N+'b')
      if 'italic' in face:E.SubElement(props,N+'i')
      E.SubElement(props,N+'sz',{N+'val':str(size*2)})
     labels=[f'Aa {i:02}' for i in range(1,5)]
     for i,label in enumerate(labels):
      if i:E.SubElement(run,N+'br')
      E.SubElement(run,N+'t').text=label
     cases.append(dict(page=len(cases),family=family,size=size,multiple=multiple,face=face,labels=labels))
 body.append(sect);parts['word/document.xml']=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():
   entry=ZipInfo(name,(2020,1,1,0,0,0));entry.compress_type=ZIP_DEFLATED;z.writestr(entry,data)
 (destination/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
 return hashlib.sha256((destination/'control.docx').read_bytes()).hexdigest()


if __name__=='__main__':print(generate())
