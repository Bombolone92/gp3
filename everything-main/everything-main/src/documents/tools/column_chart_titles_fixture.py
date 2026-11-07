"""Original rich column-chart title controls, including overlay and wrapping."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/column-chart-titles';out.mkdir(exist_ok=True)
c='http://schemas.openxmlformats.org/drawingml/2006/chart';a='http://schemas.openxmlformats.org/drawingml/2006/main';wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
cases=[('small',6,432,0,'Measured Title'),('regular',11,432,0,'Measured Title'),('large',18,432,0,'Measured Title'),('overlay',11,432,1,'Measured Title'),('mixed',11,432,0,'Measured Title'),('wrapped',11,288,0,'A longer measured chart title that wraps across several lines')]
cases += [('wrap-probe-'+str(width),11,width,0,('i '*160).strip()) for width in [288,432]]
cases += [('long-word',11,288,0,'W'*80),('negative',11,432,0,'Measured Title')]
for name,size,width,overlay,text in cases:
 with ZipFile(root/'tests/fixtures/chart-layout/chart-layout-432-288-9.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 document=E.fromstring(parts['word/document.xml'])
 for e in document.findall('.//{'+wp+'}extent'):e.set('cx',str(width*12700))
 r=E.fromstring(parts['word/charts/chart1.xml']);chart=r.find('{'+c+'}chart');title=E.Element('{'+c+'}title');chart.insert(0,title);chart.find('{'+c+'}autoTitleDeleted').set('val','0')
 tx=E.SubElement(title,'{'+c+'}tx');rich=deepcopy(r.find('.//{'+c+'}catAx/{'+c+'}txPr'));rich.tag='{'+c+'}rich';tx.append(rich)
 para=rich.find('{'+a+'}p');end=para.find('{'+a+'}endParaRPr')
 if end is not None:para.remove(end)
 default=para.find('{'+a+'}pPr/{'+a+'}defRPr');default.set('sz',str(size*100));default.set('b','0');default.find('{'+a+'}latin').set('typeface','Arial')
 for word in (['Measured ','Title'] if name=='mixed' else [text]):
  run=E.SubElement(para,'{'+a+'}r');pr=E.SubElement(run,'{'+a+'}rPr',lang='en-US')
  if name=='mixed' and word=='Title':
   pr.set('b','1');pr.set('sz','1800');E.SubElement(E.SubElement(pr,'{'+a+'}solidFill'),'{'+a+'}srgbClr',val='993366')
  E.SubElement(run,'{'+a+'}t').text=word
 E.SubElement(title,'{'+c+'}overlay',val=str(overlay));props=E.SubElement(title,'{'+c+'}spPr');E.SubElement(props,'{'+a+'}noFill');E.SubElement(E.SubElement(props,'{'+a+'}ln'),'{'+a+'}noFill');E.SubElement(props,'{'+a+'}effectLst')
 if name=='negative':
  for v in r.findall('.//{'+c+'}ser/{'+c+'}val/{'+c+'}numRef/{'+c+'}numCache/{'+c+'}pt/{'+c+'}v'):v.text=str(-abs(float(v.text)))
 parts['word/document.xml']=E.tostring(document);parts['word/charts/chart1.xml']=E.tostring(r)
 destination=out/(name+'.docx')
 if destination.exists():
  with ZipFile(destination) as z:
   if parts=={n:z.read(n) for n in z.namelist()}:continue
 with ZipFile(destination,'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
