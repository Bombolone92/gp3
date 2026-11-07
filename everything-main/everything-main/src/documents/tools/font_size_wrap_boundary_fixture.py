"""Original paragraph wrap controls, with fixed measured boundary widths."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1];p=repo/'tests/fixtures/font-size-wrap-boundary';p.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns='{'+W+'}'
with ZipFile(repo/'tests/fixtures/text-outline-miters/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);b=r.find(ns+'body');sect=b.find(ns+'sectPr');b.remove(sect);b.clear()
cases=[];widths=[324.9388732910156, 339.31109619140625, 353.46837615966797, 382.21270751953125, 510.91754150390625, 525.0748443603516, 539.4469299316406, 553.8191528320312]
for i,size in enumerate([10,10.5,11,12,16.5,17,17.5,18]):
 for variant in ['edge','wide']:
  para=E.SubElement(b,ns+'p');pr=E.SubElement(para,ns+'pPr');E.SubElement(pr,ns+'spacing',{ns+'after':'120',ns+'line':'440',ns+'lineRule':'exact'})
  if widths and variant=='edge':E.SubElement(pr,ns+'ind',{ns+'right':str(round((648-widths[i]-.1)*20))})
  run=E.SubElement(para,ns+'r');rp=E.SubElement(run,ns+'rPr');E.SubElement(rp,ns+'rFonts',{ns+'ascii':'Arial',ns+'hAnsi':'Arial'});E.SubElement(rp,ns+'sz',{ns+'val':str(int(size*2))});E.SubElement(rp,ns+'spacing',{ns+'val':'20'});E.SubElement(rp,ns+'kern',{ns+'val':'0'});E.SubElement(run,ns+'t').text='MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM';cases.append(dict(size=size,variant=variant,widthTwips=round((widths[i]+.1)*20) if variant=="edge" else 12960))
sect.find(ns+'pgSz').set(ns+'w','15840');sect.find(ns+'pgSz').set(ns+'h','12240');b.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(p/'control.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
(p/'cases.json').write_text(json.dumps(cases),encoding='utf-8')

