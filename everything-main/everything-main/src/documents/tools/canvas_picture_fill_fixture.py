"""Original shape picture-fill fixture; python-docx MIT, lxml BSD, stdlib PNG.

No editor engine generates the XML. Native references were measured independently.
"""
from pathlib import Path
from io import BytesIO
from copy import deepcopy
from zipfile import ZipFile
import struct, zlib, sys
from lxml import etree as E
from canvas_group_fixture import Document, Inches, NS, tag, shape, add

SOURCE=Path(__file__).resolve().parents[1]/'public/fixtures/shape-picture-fills.docx'
CASES=[('Full stretch',{}, {},False),('Source inset',{'l':'25000'}, {},False),
       ('Source outset',{'l':'-25000'}, {},False),
       ('Destination inset',{}, {'l':'25000','r':'25000','t':'25000','b':'25000'},False),
       ('Destination outset',{}, {'l':'-25000','r':'-25000'},False),
       ('Combined source and destination',{'l':'25000','r':'-25000'}, {'t':'25000','b':'25000'},False),
       ('Polygon clip',{}, {},True)]

def generate():
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    colors=[(240,40,30),(30,80,210),(40,170,70),(240,180,20)]
    rows=b''.join(b'\0'+b''.join(bytes(colors[(y//32)*2+x//32]) for x in range(64)) for y in range(64))
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,64,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
    doc=Document();doc.settings.element.find(tag('w:zoom')).set(tag('w:percent'),'100')
    s=doc.sections[0];s.page_width=Inches(6);s.page_height=Inches(7)
    s.left_margin=s.right_margin=s.top_margin=s.bottom_margin=Inches(.5)
    for i,(label,src,dst,custom) in enumerate(CASES):
        if i:doc.add_page_break()
        doc.add_paragraph(label)
        inline=doc.add_paragraph().add_run().add_picture(BytesIO(png),width=Inches(4),height=Inches(3))._inline
        data=inline.find('.//'+tag('a:graphicData'))
        fill=deepcopy(data.find('.//'+tag('pic:blipFill')));fill.tag=tag('a:blipFill');fill.set('dpi','0');fill.set('rotWithShape','1')
        rect=add(fill,'a:srcRect',**src);fill.remove(rect);fill.insert(1,rect)
        fill.find(tag('a:stretch')).find(tag('a:fillRect')).attrib.update(dst)
        data.clear();data.set('uri',NS['wps'])
        node=shape(data,i+1,3657600,2743200,0,0,'FFFFFF',custom=custom)
        props=node.find(tag('wps:spPr'));props.remove(props.find(tag('a:solidFill')));props.insert(2,fill)
    doc.save(SOURCE);print(SOURCE)

def verify(path):
    with ZipFile(SOURCE) as old,ZipFile(path) as new:
        assert set(old.namelist())==set(new.namelist())
        for name in old.namelist():
            if name!='word/document.xml':assert old.read(name)==new.read(name),name
        before,after=[E.fromstring(z.read('word/document.xml')) for z in [old,new]]
        def signature(n):return [(x.tag,sorted(x.attrib.items()),x.text or '') for x in n.iter()]
        assert [signature(n) for n in before.iter(tag('w:drawing'))]==[signature(n) for n in after.iter(tag('w:drawing'))]
        assert ''.join(after.itertext())=='Edited '+''.join(before.itertext())
    print('PASS independently retained picture-filled shapes:',path)

if __name__=='__main__':
    if len(sys.argv)>1:verify(sys.argv[1])
    else:generate()
