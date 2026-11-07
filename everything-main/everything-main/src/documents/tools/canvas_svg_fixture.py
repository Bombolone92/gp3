"""Original SVG picture fixture: python-docx MIT, lxml BSD and stdlib PNG.

Vector artwork and visibly different raster fallback are authored here. No user
artwork, font binary or third-party engine is used.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from io import BytesIO
from copy import deepcopy
import struct, zlib, sys
from lxml import etree as E
from canvas_group_fixture import Document, Inches, NS, tag, add, transform, shape
SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/svg-pictures.docx'
ASVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main'
A14 = 'http://schemas.microsoft.com/office/drawing/2010/main'
SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><style>.green { fill:#18a060; }</style><defs><linearGradient id="blue"><stop stop-color="#2050e0"/><stop offset="1" stop-color="#10c0d0"/></linearGradient><clipPath id="cut"><rect x="60" width="60" height="80"/></clipPath></defs><rect width="60" height="80" class="green"/><g clip-path="url(#cut)"><rect x="60" width="60" height="80" fill="url(#blue)"/></g><path d="M40 20L60 60L20 60Z" fill="#ffffff"/></svg>'''

def generate():
    def chunk(t,b): return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\0\xff\xff\0\xff'*2))+chunk(b'IEND',b'')
    doc=Document(); doc.settings.element.find(tag('w:zoom')).set(tag('w:percent'),'100'); doc.sections[0].top_margin=doc.sections[0].bottom_margin=Inches(.5)
    doc.add_paragraph('SVG vector pictures')
    for label in ['Full vector','Cropped vector','Grouped vector','Shape fill vector']:
        doc.add_paragraph(label)
        inline=doc.add_paragraph().add_run().add_picture(BytesIO(png),width=Inches(1.5),height=Inches(1))._inline
        blip=inline.find('.//'+tag('a:blip')); extensions=add(blip,'a:extLst')
        for svg in ([True,False] if label=='Cropped vector' else [False,True]):
            ext=add(extensions,'a:ext',uri='{96DAC541-7B7A-43D3-8B79-37D633B846F1}' if svg else '{28A0092B-C50C-407E-A947-70E740481C1C}')
            if svg:E.SubElement(ext,'{'+ASVG+'}svgBlip',{tag('r:embed'):'rIdVector'},nsmap={'asvg':ASVG})
            else:E.SubElement(ext,'{'+A14+'}useLocalDpi',{'val':'0'},nsmap={'a14':A14})
        if label=='Cropped vector':
            fill=blip.getparent();fill.insert(1,E.Element(tag('a:srcRect'),l='25000',r='0'))
        if label in ['Grouped vector','Shape fill vector']:
            data=inline.find('.//'+tag('a:graphicData'));pic=deepcopy(data[0]);data.remove(data[0])
            if label=='Grouped vector':
                data.set('uri',NS['wpg']);group=add(data,'wpg:wgp');add(group,'wpg:cNvGrpSpPr')
                props=add(group,'wpg:grpSpPr');transform(props,1371600,914400)
                xf=props[0];add(xf,'a:chOff',x=0,y=0);add(xf,'a:chExt',cx=1371600,cy=914400);group.append(pic)
            else:
                data.set('uri',NS['wps']);s=shape(data,51,1371600,914400,0,0,'FFFFFF')
                pr=s.find(tag('wps:spPr'));pr.remove(pr.find(tag('a:solidFill')))
                fill=deepcopy(pic.find(tag('pic:blipFill')));fill.tag=tag('a:blipFill');pr.insert(2,fill)
    doc.add_paragraph('End of vector pictures.')
    doc.save(SOURCE)
    with ZipFile(SOURCE) as z:parts={n:z.read(n) for n in z.namelist()}
    root=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(root,root.tag.replace('Relationships','Relationship'),Id='rIdVector',Type=NS['r']+'/image',Target='media/vector.svg');parts['word/_rels/document.xml.rels']=E.tostring(root)
    root=E.fromstring(parts['[Content_Types].xml']);E.SubElement(root,root.tag.replace('Types','Default'),Extension='svg',ContentType='image/svg+xml');parts['[Content_Types].xml']=E.tostring(root)
    parts['word/media/vector.svg']=SVG
    with ZipFile(SOURCE,'w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)

def verify(path):
    with ZipFile(SOURCE) as a,ZipFile(path) as b:
        assert set(a.namelist())==set(b.namelist())
        for n in a.namelist():
            if n!='word/document.xml':assert a.read(n)==b.read(n),n
        x,y=[E.fromstring(z.read('word/document.xml')) for z in [a,b]]
        signature=lambda n:[(e.tag,sorted(e.attrib.items()),e.text or '') for e in n.iter()]
        assert [signature(n) for n in x.findall('.//'+tag('w:drawing'))]==[signature(n) for n in y.findall('.//'+tag('w:drawing'))]
        assert ''.join(y.itertext()).startswith('Edited SVG vector pictures')
    print('PASS SVG sources, raster fallbacks, relationships and complete drawing trees:',path)

if __name__=='__main__':
    if len(sys.argv)==1:generate()
    else:
        for p in sys.argv[1:]:verify(p)
