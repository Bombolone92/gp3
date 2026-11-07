"""Original column-chart legend controls, without corpus artwork."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/column-chart-legends';out.mkdir(exist_ok=True)
c='http://schemas.openxmlformats.org/drawingml/2006/chart';a='http://schemas.openxmlformats.org/drawingml/2006/main';wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
cases=[('bottom-6',6,432,'Arial'),('bottom-9',9,432,'Arial'),('bottom-18',18,432,'Arial'),('bottom-narrow',9,216,'Arial'),('bottom-long',9,288,'Arial'),('bottom-calibri',11,432,'Calibri')]
cases += [('bottom-rows',9,144,'Arial'),('bottom-wrap',9,180,'Arial'),('bottom-wrap-two',9,216,'Arial'),('bottom-clustered',9,432,'Arial'),('clustered-low-headroom',9,432,'Arial'),('clustered-high-headroom',9,432,'Arial')]
cases += [('clustered-height-'+str(h),9,432,'Arial') for h in [144,180,186,192,204,216,360]]
cases += [('clustered-axis18-'+str(h),9,432,'Arial') for h in [288,300]]
for name,size,width,font in cases:
 with ZipFile(root/'tests/fixtures/column-chart-titles/regular.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 d=E.fromstring(parts['word/document.xml'])
 for e in d.findall('.//{'+wp+'}extent'):
  e.set('cx',str(width*12700))
  if name.startswith(('clustered-height-','clustered-axis18-')):e.set('cy',str(int(name.rsplit('-',1)[1])*12700))
 r=E.fromstring(parts['word/charts/chart1.xml']);chart=r.find('{'+c+'}chart');legend=E.Element('{'+c+'}legend');chart.insert(list(chart).index(chart.find('{'+c+'}plotArea'))+1,legend)
 E.SubElement(legend,'{'+c+'}legendPos',val='b');E.SubElement(legend,'{'+c+'}overlay',val='0')
 sp=E.SubElement(legend,'{'+c+'}spPr');E.SubElement(sp,'{'+a+'}noFill');E.SubElement(E.SubElement(sp,'{'+a+'}ln'),'{'+a+'}noFill');E.SubElement(sp,'{'+a+'}effectLst')
 tx=deepcopy(r.find('.//{'+c+'}catAx/{'+c+'}txPr'));legend.append(tx)
 pr=tx.find('.//{'+a+'}defRPr');pr.set('sz',str(size*100));pr.find('{'+a+'}latin').set('typeface',font)
 for i,ser in enumerate(r.findall('.//{'+c+'}barChart/{'+c+'}ser')):
  ser.find('.//{'+c+'}tx/{'+c+'}strRef/{'+c+'}strCache/{'+c+'}pt/{'+c+'}v').text=(['A long first series','Another long series','Third long series'] if name in ['bottom-long','bottom-wrap','bottom-wrap-two'] else ['Class 1','Class 2','Class 3'])[i]
 if name=='bottom-clustered' or name.startswith('clustered-'):r.find('.//{'+c+'}barChart/{'+c+'}grouping').set('val','clustered')
 if name.startswith('clustered-axis18-'):r.find('.//{'+c+'}valAx/{'+c+'}txPr//{'+a+'}defRPr').set('sz','1800')
 if name.startswith('clustered-'):
  factor=.96 if name=='clustered-high-headroom' else .94
  for v in r.findall('.//{'+c+'}ser/{'+c+'}val/{'+c+'}numRef/{'+c+'}numCache/{'+c+'}pt/{'+c+'}v'):v.text=str(float(v.text)*factor)
 parts['word/document.xml']=E.tostring(d);parts['word/charts/chart1.xml']=E.tostring(r)
 dest=out/(name+'.docx')
 if dest.exists():
  with ZipFile(dest) as z:
   if parts=={n:z.read(n) for n in z.namelist()}:continue
 with ZipFile(dest,'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
