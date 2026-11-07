"""Original header/footer tables with nesting, shading, a page field and picture."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships'
with ZipFile(root/'public/fixtures/retained-story-controls.docx') as z:parts={n:z.read(n) for n in ['[Content_Types].xml','_rels/.rels','word/styles.xml','word/settings.xml']}
with ZipFile(root/'public/fixtures/hidden-cell-mark.docx') as z:
 parts['word/media/square.png']=z.read('word/media/square.png')
 picture=E.tostring(E.fromstring(z.read('word/document.xml')).find('.//{%s}drawing/..'%W)).decode()
def run(text):return f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
def p(text='',extra='',contents=None):return f'<w:p><w:pPr>{extra}<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:pPr>{run(text) if contents is None else contents}</w:p>'
def cell(content,width,fill='FFFFFF',span=1):return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>'+ (f'<w:gridSpan w:val="{span}"/>' if span>1 else '')+f'<w:shd w:val="clear" w:fill="{fill}"/></w:tcPr>{content}</w:tc>'
def table(widths,rows):
 borders=''.join(f'<w:{s} w:val="single" w:sz="8" w:color="000000"/>' for s in ['top','left','bottom','right','insideH','insideV'])
 margins=''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])
 return f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)+'</w:tblGrid>'+''.join('<w:tr>'+r+'</w:tr>' for r in rows)+'</w:tbl>'
pagefield='<w:fldSimple w:instr="PAGE">'+run('99')+'</w:fldSimple>'
header=table([2880,2880],[cell(p('Header table'),2880,'D9EAF7')+cell(p(contents=run('Page ')+pagefield),2880),cell(p('Header spanning row'),5760,'FFF2CC',2)])+p()
nested=table([2160,2160],[cell(p('Contact A'),2160)+cell(p('Contact B'),2160)])
footer=table([4320,1440],[cell(p('Footer table')+nested+p(),4320,'E2F0D9')+cell(p(contents=picture),1440)])+p('Footer ending')
for kind,content in [('header',header),('footer',footer)]:parts[f'word/{kind}.xml']=f'<w:{"hdr" if kind=="header" else "ftr"} xmlns:w="{W}" xmlns:r="{R}">{content}</w:{"hdr" if kind=="header" else "ftr"}>'.encode()
parts['word/_rels/footer.xml.rels']=f'<Relationships xmlns="{REL}"><Relationship Id="square" Type="{R}/image" Target="media/square.png"/></Relationships>'.encode()
section='<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="7200" w:h="10080"/><w:pgMar w:top="1800" w:right="720" w:bottom="2160" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{p("First body page")}{p("Second body page","<w:pageBreakBefore/>")}{section}</w:body></w:document>'.encode()
parts['word/_rels/document.xml.rels']=('<Relationships xmlns="'+REL+'">'+''.join(f'<Relationship Id="{k}" Type="{R}/{k}" Target="{k}.xml"/>' for k in ['styles','settings','header','footer'])+'</Relationships>').encode()
with ZipFile(root/'public/fixtures/page-story-tables.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
