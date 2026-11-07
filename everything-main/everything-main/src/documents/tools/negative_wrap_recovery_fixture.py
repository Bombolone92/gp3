"""Original OPC/XML pairs for signed-offset wrapping recovery; stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from top_bottom_flow_fixture import make, drawing, paragraph, W, WP, A, PIC, R
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/negative-wrap-recovery'
NS=f'xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
def content(affected,matched):
    def picture(i,y,h):
        d=drawing(i,y,h)
        return d.replace('<wp:wrapTopAndBottom/>','<wp:wrapNone/>') if matched and y<0 else d
    return (paragraph('Healthy heading',before=200)+paragraph('Healthy preceding text',before=200)
      +paragraph('First signed picture',drawings=picture(1,-8 if affected else 8,12))
      +paragraph('Healthy middle',before=500)
      +'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>'+paragraph('Healthy table cell')+'</w:tc></w:tr></w:tbl>'
      +paragraph('Healthy supported wrapping',drawings=picture(2,8,12))
      +paragraph('Healthy following text',before=500)
      +paragraph('Last signed picture',drawings=picture(3,-24 if affected else 8,12))
      +paragraph('Healthy ending',before=500))
def build():
 OUT.mkdir(parents=True,exist_ok=True)
 for scope in ['body','header','footer']:
  for matched in [False,True]:
   parts=make(15)
   story=scope if scope!='body' else 'header'
   parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/{story}.xml" ContentType="{CT}{story}+xml"/></Types>')
   parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="story" Type="{R}/{story}" Target="{story}.xml"/></Relationships>')
   parts[f'word/_rels/{story}.xml.rels']=f'<Relationships xmlns="{REL}"><Relationship Id="picture" Type="{R}/image" Target="media/panel.png"/></Relationships>'
   tag='hdr' if story=='header' else 'ftr'
   parts[f'word/{story}.xml']=f'<w:{tag} {NS}>'+ (paragraph('Healthy header') if scope=='body' else content(True,matched))+f'</w:{tag}>'
   body=content(True,matched) if scope=='body' else content(False,matched)
   sect=f'<w:sectPr><w:{story}Reference w:type="default" r:id="story"/><w:pgSz w:w="12240" w:h="24480"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
   parts['word/document.xml']=f'<w:document {NS}><w:body>{body}{sect}</w:body></w:document>'
   with ZipFile(OUT/f'{scope}-{"matched" if matched else "unsupported"}.docx','w') as z:
    for name,data in parts.items():
     info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
if __name__=='__main__':build()
