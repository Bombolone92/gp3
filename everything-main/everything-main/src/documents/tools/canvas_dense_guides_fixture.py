"""Original dense guide chain determining the width of visible rectangle ink."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
COUNT=32768

def generate():
 with ZipFile(ROOT/'public/fixtures/dense-path.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 root=E.fromstring(parts['word/document.xml']);root.find('.//{'+W+'}t').text='Dense guide geometry'
 custom=root.find('.//{'+A+'}custGeom');av=custom.find('{'+A+'}avLst');E.SubElement(av,'{'+A+'}gd',name='adj',fmla='val 1')
 gd=custom.find('{'+A+'}gdLst')
 for i in range(COUNT):E.SubElement(gd,'{'+A+'}gd',name=f'g{i}',fmla=f'+- g{i-1} 1 0' if i else 'val adj')
 path=custom.find('.//{'+A+'}path');path.clear();path.set('w','65536');path.set('h','65536')
 for tag,x,y in [('moveTo','0','0'),('lnTo',f'g{COUNT-1}','0'),('lnTo',f'g{COUNT-1}','49152'),('lnTo','0','49152')]:E.SubElement(E.SubElement(path,'{'+A+'}'+tag),'{'+A+'}pt',x=x,y=y)
 E.SubElement(path,'{'+A+'}close')
 parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(ROOT/'public/fixtures/dense-guides.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
 (ROOT/'tests/fixtures/dense-guides').mkdir(exist_ok=True)
if __name__=='__main__':generate()
