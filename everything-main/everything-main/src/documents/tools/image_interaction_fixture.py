"""Original XML and artwork controls for image editing and print interactions."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from xml.etree import ElementTree as E
from top_bottom_flow_fixture import make,drawing,paragraph,W,WP,A,PIC,R
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/image-interaction'
def build():
    parts=make(15)
    def floating(i,top,height,behind=True):
        return drawing(i,top,height).replace('<wp:wrapTopAndBottom/>','<wp:wrapNone/>').replace('behindDoc="1"',f'behindDoc="{int(behind)}"')
    node=E.fromstring(f'<root xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}">'+drawing(3,0,30)+'</root>')
    anchor=node.find('.//{'+WP+'}anchor');anchor.tag='{'+WP+'}inline';anchor.attrib.clear()
    for child in list(anchor):
        if child.tag.split('}')[-1] in ['simplePos','positionH','positionV','wrapTopAndBottom']:anchor.remove(child)
    inline=E.tostring(node[0],encoding='unicode')
    body=paragraph('Editable text',drawings=floating(1,0,60))+paragraph('Text remains selectable')+paragraph('Second picture anchor',drawings=floating(2,90,30))+paragraph('Before inline picture')+paragraph(drawings=inline)+paragraph('Drop image here')
    sect='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{body}{sect}</w:body></w:document>'
    OUT.mkdir(parents=True,exist_ok=True)
    with ZipFile(OUT/'control.docx','w') as z:
        for name,data in parts.items():
            info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
if __name__=='__main__':build()
