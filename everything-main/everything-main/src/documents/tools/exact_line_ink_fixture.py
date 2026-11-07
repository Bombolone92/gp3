"""Original text/decoration/picture controls for short exact line boxes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct
import zlib

root = Path(__file__).resolve().parents[1]
with ZipFile(root / 'public/fixtures/reviewed-font.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="48"/>'
def run(text, extra=''):
    return f'<w:r><w:rPr>{font}{extra}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
def picture(i):
    return f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="508000" cy="508000"/><wp:docPr id="{i}" name="Original cyan square {i}"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Cyan square"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdInk"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="508000" cy="508000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
cases = [run('TALL GLYPHS'), run('DECORATED', '<w:color w:val="CC0000"/><w:highlight w:val="yellow"/><w:u w:val="single"/>'), picture(1)+run(' MIXED'), picture(2), run('RAISED', '<w:position w:val="16"/>'), run('LOWERED', '<w:position w:val="-16"/>'), run('ADJACENT TOP')+'<w:r><w:br/></w:r>'+run('ADJACENT BOTTOM')]
body = ''.join(f'<w:p><w:pPr><w:spacing w:before="0" w:after="960" w:line="240" w:lineRule="exact"/><w:rPr>{font}</w:rPr></w:pPr>{content}</w:p>' for content in cases)
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}"><w:body>{body}</w:body></w:document>'.encode()
parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace(b'</Relationships>',f'<Relationship Id="rIdInk" Type="{R}/image" Target="media/ink.png"/></Relationships>'.encode())
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'</Types>', b'<Default Extension="png" ContentType="image/png"/></Types>')
def chunk(tag, data): return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data))
parts['word/media/ink.png'] = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',8,8,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\x00\xb8\xd4'*8)*8))+chunk(b'IEND',b'')
with ZipFile(root / 'public/fixtures/exact-line-ink.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
