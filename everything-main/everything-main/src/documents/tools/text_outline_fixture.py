"""Original text-outline control; no corpus text or assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14='http://schemas.microsoft.com/office/word/2010/wordml'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
outline='<w14:textOutline w14:w="9525" w14:cap="rnd" w14:cmpd="sng" w14:algn="ctr"><w14:solidFill><w14:srgbClr w14:val="008080"/></w14:solidFill><w14:prstDash w14:val="solid"/><w14:bevel/></w14:textOutline>'
def para(text,props=''):
 return '<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr>'+props+'</w:rPr><w:t>'+text+'</w:t></w:r></w:p>'
body=para('Ordinary text control')+para('Direct outlined text','<w:color w:val="FFFFFF"/>'+outline)+para('Inherited outlined text','<w:rStyle w:val="Outlined"/>')+para('Direct color plus outline','<w:rStyle w:val="Outlined"/><w:color w:val="FFC000"/>')
body+='<w:tbl><w:tblPr><w:tblW w:w="8640" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/><w:gridCol w:w="4320"/></w:tblGrid><w:tr>'
for text in ['Left card','Right card']:
 body+='<w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'+para(text,'<w:rStyle w:val="Outlined"/>')+'</w:tc>'
body+='</w:tr></w:tbl>'+para('After the table')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
ns=f'xmlns:w="{W}" xmlns:w14="{W14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
'_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
'word/document.xml':f'<w:document {ns}><w:body>{body}</w:body></w:document>',
'word/styles.xml':f'<w:styles {ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="40"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="character" w:styleId="Outlined"><w:name w:val="Outlined"/><w:rPr><w:color w:val="FFFFFF"/>{outline}</w:rPr></w:style></w:styles>'}
with ZipFile(Path(__file__).resolve().parents[1]/'public/fixtures/text-outline-control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items(): z.writestr(name,data)
