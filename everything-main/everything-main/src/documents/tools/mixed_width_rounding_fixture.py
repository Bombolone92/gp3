"""Deterministic width sweep derived only from our original mixed-width control."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
r=Path(__file__).resolve().parents[1]; source=r/'tests/fixtures/mixed-cell-width-content/control.docx';out=r/'tests/fixtures/mixed-width-rounding';out.mkdir(parents=True,exist_ok=True)
with ZipFile(source) as z:parts={n:z.read(n) for n in z.namelist()}
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
root=E.fromstring(parts['word/document.xml']);body=root.find(W+'body');section=deepcopy(body.find(W+'sectPr'));tables=body.findall(W+'tbl');prototypes=[deepcopy(tables[i]) for i in [1,9]];body.clear();cases=[]
for scope,prototype in zip(['body','all'],prototypes):
 for width in range(5990,6011):
  p=E.SubElement(body,W+'p');pr=E.SubElement(p,W+'pPr')
  if cases:E.SubElement(pr,W+'pageBreakBefore')
  run=E.SubElement(p,W+'r');E.SubElement(run,W+'t').text=f'{scope} {width}'
  table=deepcopy(prototype);table.find(W+'tblPr').find(W+'tblW').set(W+'w',str(width));table.findall(W+'tr')[-1].find(W+'tc').find(W+'tcPr').find(W+'tcW').set(W+'w',str(width));body.append(table)
  E.SubElement(body,W+'p');cases.append(dict(scope=scope,width=width))
body.append(section);parts['word/document.xml']=E.tostring(root)
with ZipFile(out/'control.docx','w') as z:
 for n,b in parts.items():
  i=ZipInfo(n,(2026,9,29,12,0,0));i.create_system=0;i.external_attr=0o600<<16;z.writestr(i,b,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
