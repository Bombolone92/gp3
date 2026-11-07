"""Independent row-height probes extending the original hand-authored XML grid."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from canvas_row_border_insets_fixture import build, W

def generate():
    path=Path(__file__).resolve().parents[1]/'public/fixtures/compound-row-insets.docx'
    cases=[(style,rule) for style in ['single','double','triple'] for rule in ['auto','atLeast','exact']]
    build([(False,16,0)]*len(cases),path)
    with ZipFile(path) as z: parts={name:z.read(name) for name in z.namelist()}
    root=E.fromstring(parts['word/document.xml']);E.register_namespace('w',W)
    for table,(style,rule) in zip(root.iter(f'{{{W}}}tbl'),cases):
        for edge in table.iter():
            if edge.tag in [f'{{{W}}}top',f'{{{W}}}bottom'] and edge.get(f'{{{W}}}val')=='single':edge.set(f'{{{W}}}val',style)
        if rule!='auto':
            for row in list(table.findall(f'{{{W}}}tr'))[1:]:
                E.SubElement(row.find(f'{{{W}}}trPr'),f'{{{W}}}trHeight',{f'{{{W}}}val':'960',f'{{{W}}}hRule':rule})
    parts['word/document.xml']=E.tostring(root,encoding='utf-8',xml_declaration=True)
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
    print(path)

if __name__=='__main__':generate()
