"""Original RGBA PNG and DrawingML alpha probes; stdlib-only source generator."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct,zlib
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships'
A14='http://schemas.microsoft.com/office/drawing/2010/main'
def png(color,alphas):
 def chunk(t,data):return struct.pack('>I',len(data))+t+data+struct.pack('>I',zlib.crc32(t+data)&0xffffffff)
 rows=b''.join(b'\0'+b''.join(bytes([*color,alphas[x//16]]) for x in range(64)) for _ in range(16))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,16,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
cases=[('Absent',''),('Default','<a:alphaModFix/>')]+[(v,f'<a:alphaModFix amt="{v}"/>') for v in ['0','1','50000','90000','100000','150000','200000','500000','50%']]
cases += [('Repeated','<a:alphaModFix amt="50000"/><a:alphaModFix amt="50000"/>'),('Cached edits','<a:alphaModFix amt="90000"/><a:extLst><a:ext uri="{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}"><a14:imgProps><a14:imgLayer r:embed="original"><a14:imgEffect><a14:brightnessContrast contrast="-14000"/></a14:imgEffect></a14:imgLayer></a14:imgProps></a:ext></a:extLst>')]
rows=''
cases[-1:-1] = [('High then half','<a:alphaModFix amt="200000"/><a:alphaModFix amt="50000"/>'),('Half then high','<a:alphaModFix amt="50000"/><a:alphaModFix amt="200000"/>')]
for i,(label,effect) in enumerate(cases):
 drawing=f'<w:r><w:drawing><wp:inline><wp:extent cx="1219200" cy="304800"/><wp:docPr id="{i+1}" name="{label}"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="{i+1}" name="{label}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="main">{effect}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1219200" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
 rows+=f'<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>{label}</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="120"/></w:pPr>{drawing}</w:p></w:tc></w:tr>'
parts={
 '[Content_Types].xml':b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="doc" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>'.encode(),
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/image" Target="media/main.png"/><Relationship Id="original" Type="{R}/image" Target="media/original.png"/></Relationships>'.encode(),
 'word/media/main.png':png([200,40,80],[255,128,64,0]),'word/media/original.png':png([20,80,220],[255]*4),
 'word/document.xml':f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}" xmlns:r="{R}" xmlns:a14="{A14}"><w:body><w:p><w:r><w:t>Picture alpha probes</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>{rows}</w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'.encode()}
out=ROOT/'public/fixtures/picture-alpha.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
print(out)
