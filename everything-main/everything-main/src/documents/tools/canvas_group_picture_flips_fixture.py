"""Original OPC/XML and PNG probe for grouped picture reflections; stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct
import zlib
from canvas_first_section_fixture import parts as base, W, R, REL

ROOT = Path(__file__).resolve().parents[1]
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
G = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

def xfrm(w, h, x=0, y=0, flags='', child=None):
    return f'<a:xfrm {flags}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/>' + (f'<a:chOff x="10000" y="-20000"/><a:chExt cx="{child[0]}" cy="{child[1]}"/>' if child else '') + '</a:xfrm>'

def group(content, nested=False):
    name = 'grpSp' if nested else 'wgp'
    # Nested nonuniform scales compose to a 144 x 72 pt frame.
    w, h = (914400, 1828800) if nested else (1828800, 914400)
    child = (457200, 914400) if nested else (914400, 1828800)
    return f'<wpg:{name}>' + ('<wpg:cNvPr id="100" name="Nested"/>' if nested else '') + '<wpg:cNvGrpSpPr/><wpg:grpSpPr>' + xfrm(w, h, 10000 if nested else 0, -20000 if nested else 0, child=child) + f'</wpg:grpSpPr>{content}</wpg:{name}>'

def generate():
    colors = [bytes.fromhex(c) for c in ['E02030', '20A050', '2050D0', 'E0B020']]
    pixels = b''.join(b'\0' + b''.join(colors[(y >= 20)*2 + (x >= 20)] for x in range(40)) for y in range(40))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',40,40,8,2,0,0,0)) + chunk(b'IDAT',zlib.compress(pixels)) + chunk(b'IEND',b'')
    cases = [('', ''), ('flipH="true"',''), ('flipV="1"',''), ('flipH="1" flipV="true"',''), ('flipH="true"','l="25000" t="12500"'), ('flipH="1" flipV="1"','l="-50000" t="-100000"')]
    body = '<w:p><w:r><w:t>Grouped picture flips</w:t></w:r></w:p>'
    for i,(flags,crop) in enumerate(cases,1):
        pic = '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Quadrants"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="pixels"/>' + f'<a:srcRect {crop}/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr>' + xfrm(457200,914400,10000,-20000,flags) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
        # Page-relative anchors make the independent PDF's sample coordinates exact.
        body += f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{12700*(100+(i-1)*95)}</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="914400"/><wp:wrapNone/><wp:docPr id="{i}" name="Case {i}"/><a:graphic><a:graphicData uri="{G}">{group(group(pic,True))}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts = dict(base)
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="pixels" Type="{R}/image" Target="media/quadrants.png"/></Relationships>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}" xmlns:wpg="{G}"><w:body>{body}</w:body></w:document>'
    parts['word/media/quadrants.png'] = png
    out = ROOT / 'public/fixtures/group-picture-flips.docx'
    with ZipFile(out,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items(): z.writestr(name,data)
    print(out)

if __name__ == '__main__': generate()
