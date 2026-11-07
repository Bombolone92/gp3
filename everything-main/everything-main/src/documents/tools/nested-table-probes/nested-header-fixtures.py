"""Independent table-header probes built from directly authored OOXML sources."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import sys
work=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables'
work.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda n:'{'+W+'}'+n
def header(row):
    props=row.find(q('trPr'))
    if props is None:props=E.Element(q('trPr'));row.insert(0,props)
    E.SubElement(props,q('tblHeader'))
for mode in ['header-inner','header-outer','header-container']:
    source=work/('nested-clipping-inner-exact.docx' if mode=='header-container' else 'nested-table-paging.docx')
    with ZipFile(source) as z:parts={name:z.read(name) for name in z.namelist()}
    document=E.fromstring(parts['word/document.xml']);outer=document.find('.//'+q('tbl'))
    inner=outer.find('.//'+q('tbl'))
    if mode=='header-container':
        header(outer.find(q('tr')))
        for i in range(40):
            row=E.SubElement(outer,q('tr'));cell=E.SubElement(row,q('tc'))
            cell.append(deepcopy(outer.find(q('tr')).find(q('tc')).find(q('tcPr'))))
            paragraph=deepcopy(document.find(q('body')).find(q('p')))
            paragraph.find('.//'+q('t')).text=f'Body row {i+1}'
            cell.append(paragraph)
    else:
        header(inner.find(q('tr')))
        if mode=='header-outer':
            row=deepcopy(outer.findall(q('tr'))[-1]);header(row)
            for i,text in enumerate(row.iter(q('t'))):text.text=f'Outer header {i+1}'
            outer.insert(2,row)
    parts['word/document.xml']=E.tostring(document,xml_declaration=True,encoding='UTF-8')
    path=work/f'nested-clipping-{mode}.docx'
    with ZipFile(path,'w') as z:
        for name,data in parts.items():
            info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
    print(path)
