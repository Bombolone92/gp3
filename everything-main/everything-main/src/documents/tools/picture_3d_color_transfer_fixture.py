"""Original textless RGB controls for 3D picture front-face color transfer.

Generate into a fresh directory; no source or native evidence is overwritten.
"""
import argparse,json,struct,zlib
from pathlib import Path
from itertools import product
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
from top_bottom_flow_fixture import make,drawing,paragraph,W,WP,A,PIC,R


def generate(output,grayscale=False,matte=False):
    output.mkdir(parents=True,exist_ok=False)
    colors=[[v,v,v] for v in [*range(0,256,16),255]]
    colors += [[v if i==axis else 0 for i in range(3)] for axis in range(3) for v in range(0,256,51)]
    colors += [[240,40,30],[30,80,210],[40,170,70],[240,180,20],[20,80,190]]
    colors += [list(rgb) for rgb in list(product([20,80,190],repeat=3))[:24]]
    assert len(colors)==64
    if grayscale:colors=[[v,v,v] for v in range(256)]
    grid=16 if grayscale else 8;size=grid*32
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    scanlines=b''.join(b'\0'+b''.join(bytes(colors[(y//32)*grid+x//32]) for x in range(size)) for y in range(size))
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(scanlines))+chunk(b'IEND',b'')
    parts=make(15);parts['word/media/panel.png']=png
    cases=[{'id':1,'material':None,'rig':'threePt'},{'id':2,'material':'warmMatte','rig':'threePt'},{'id':3,'material':'warmMatte','rig':'twoPt'}]
    if matte:
        for case in cases[1:]:case['material']='matte'
    body=[]
    for case in cases:
        root=E.fromstring(f'<root xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}">{drawing(case["id"],20,160)}</root>')
        frame=root.find(f'.//{{{WP}}}anchor');frame.set('behindDoc','0');frame.find(f'{{{WP}}}wrapTopAndBottom').tag=f'{{{WP}}}wrapNone'
        frame.find(f'{{{WP}}}extent').set('cx',str(160*12700))
        props=root.find(f'.//{{{PIC}}}spPr');props.find(f'{{{A}}}xfrm/{{{A}}}ext').set('cx',str(160*12700))
        scene=E.SubElement(props,f'{{{A}}}scene3d');E.SubElement(scene,f'{{{A}}}camera',prst='orthographicFront');E.SubElement(scene,f'{{{A}}}lightRig',rig=case['rig'],dir='t')
        solid=E.SubElement(props,f'{{{A}}}sp3d',extrusionH='127000',contourW='25400')
        if case['material']:solid.set('prstMaterial',case['material'])
        color=E.SubElement(solid,f'{{{A}}}contourClr');E.SubElement(color,f'{{{A}}}srgbClr',val='202060')
        body.append(paragraph(page_break=case['id']>1,drawings=E.tostring(root[0],encoding='unicode')))
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
    with ZipFile(output/'source.docx','x') as archive:
        for name,data in parts.items():
            item=ZipInfo(name,date_time=(2026,1,1,0,0,0));item.compress_type=ZIP_DEFLATED;archive.writestr(item,data)
    (output/'cases.json').write_text(json.dumps({'cases':cases,'colors':colors,'grid':grid,'tilePixels':32,'framePt':160},indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);parser.add_argument('--grayscale',action='store_true');parser.add_argument('--matte',action='store_true')
    args=parser.parse_args();generate(args.output,args.grayscale,args.matte)
