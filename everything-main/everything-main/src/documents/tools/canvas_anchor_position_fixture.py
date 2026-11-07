"""Original OPC/XML and PNG positioning fixtures, using only Python stdlib.

Native reference probes establish the compatibilityMode14 right-alignment clamp;
mode15 follows the page edge. No document engine generates these packages.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import struct, zlib, sys
from canvas_first_section_fixture import parts as shell, W, R, REL, CT

ROOT = Path(__file__).resolve().parents[1]
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
CASES = [('page','left','top'), ('page','center','center'), ('page','right','bottom'),
         ('margin','left','top'), ('margin','center','center'), ('margin','right','bottom'),
         ('page',914400,457200), ('margin',914400,457200)]

def make(mode):
    parts = dict(shell)
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Default Extension="png" ContentType="image/png"/><Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="picture" Type="{R}/image" Target="media/panel.png"/><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
    body = []
    for i,(base,h,v) in enumerate(CASES):
        if i: body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        position = ''.join(f'<wp:position{axis} relativeFrom="{base}"><wp:{"posOffset" if isinstance(value,int) else "align"}>{value}</wp:{"posOffset" if isinstance(value,int) else "align"}></wp:position{axis}>' for axis,value in [('H',h),('V',v)])
        body.append(f'''<w:p><w:r><w:t>Anchor {i+1}: {base}</w:t></w:r><w:r><w:drawing>
<wp:anchor simplePos="0" relativeHeight="{i}" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1" distT="0" distB="0" distL="0" distR="0">
<wp:simplePos x="0" y="0"/>{position}<wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="{i+1}" name="Panel {i+1}"/><wp:cNvGraphicFramePr/>
<a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="panel.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>
</wp:anchor></w:drawing></w:r></w:p>''')
    body.append('<w:sectPr><w:pgSz w:w="11520" w:h="14400"/><w:pgMar w:top="1080" w:right="2160" w:bottom="1800" w:left="1440" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    parts['word/media/panel.png'] = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([20,80,190])*16)*16))+chunk(b'IEND',b'')
    return parts

def verify(path):
    mode = 14 if 'legacy' in Path(path).name else 15
    original=make(mode)
    with ZipFile(path) as z:
        assert set(z.namelist())==set(original)
        for name,data in original.items():
            if name!='word/document.xml':assert z.read(name)==(data.encode() if isinstance(data,str) else data),name
        root=ET.fromstring(z.read('word/document.xml'))
        def signature(n):return [(e.tag,sorted(e.attrib.items()),(e.text or '').strip()) for e in n.iter()]
        before=ET.fromstring(original['word/document.xml'])
        assert [signature(n) for n in root.iter('{'+WP+'}anchor')]==[signature(n) for n in before.iter('{'+WP+'}anchor')]
        assert ''.join(n.text or '' for n in root.iter('{'+W+'}t')).startswith('Edited Anchor 1: page')
    print('PASS independently preserved positioned anchors:',path)

if __name__=='__main__':
    if len(sys.argv)>1:verify(sys.argv[1])
    else:
        for mode,name in [(15,'anchor-position.docx'),(14,'anchor-position-legacy.docx')]:
            path=ROOT/'public/fixtures'/name
            with ZipFile(path,'w',ZIP_DEFLATED) as z:
                for key,data in make(mode).items():z.writestr(key,data)
            print(path)
