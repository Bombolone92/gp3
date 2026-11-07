"""Original SVG/PNG pictures in standalone and grouped WPS text frames."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import struct, zlib
import drawing_text_editing_fixture as base
import drawing_text_structures_fixture as structures
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/drawing-text-pictures'
W=base.NS['w']; A=base.NS['a']; WP=base.NS['wp']; R=base.NS['r']
PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
SVG='http://schemas.microsoft.com/office/drawing/2016/SVG/main'
def png():
 def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',8,8,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([240,40,30])*8)*8))+chunk(b'IEND',b'')
def build():
 with ZipFile(ROOT/'tests/fixtures/drawing-text-editing/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 root=E.fromstring(parts['word/document.xml'])
 for index,frame in enumerate(root.findall('.//{'+W+'}txbxContent')):
  blip='<a:blip r:embed="rPng">'+('<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip r:embed="rSvg"/></a:ext></a:extLst>' if index!=1 else '')+'</a:blip>'
  picture=f'<w:r><w:drawing><wp:inline><wp:extent cx="228600" cy="228600"/><wp:docPr id="{500+index}" name="Original square" descr="Own red square"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Own square"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>{blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="228600" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  frame.replace(frame[1],E.fromstring(f'<w:p {base.DECL} xmlns:pic="{PIC}" xmlns:asvg="{SVG}"><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t xml:space="preserve">Before </w:t></w:r>'+picture+'<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'))
 parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rPng" Type="{R}/image" Target="media/square.png"/><Relationship Id="rSvg" Type="{R}/image" Target="media/square.svg"/></Relationships>'.encode()
 types=E.fromstring(parts['[Content_Types].xml'])
 for ext,mime in [('png','image/png'),('svg','image/svg+xml')]:E.SubElement(types,'{'+types.nsmap[None]+'}Default',Extension=ext,ContentType=mime)
 parts['[Content_Types].xml']=E.tostring(types)
 parts['word/media/square.png']=png()
 parts['word/media/square.svg']=b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8" fill="#f0281e"/></svg>'
 return parts
def structured(parts):
 parts=dict(parts);root=E.fromstring(parts['word/document.xml']);frames=root.findall('.//{'+W+'}txbxContent')
 paragraph=frames[1][1];wrapper=E.fromstring(f'<w:sdt xmlns:w="{W}"><w:sdtPr><w:alias w:val="Picture block"/><w:id w:val="900"/></w:sdtPr><w:sdtContent/></w:sdt>')
 frames[1].replace(paragraph,wrapper);wrapper[1].append(paragraph)
 paragraph=frames[2][1];table=E.fromstring(f'<root xmlns:w="{W}">'+structures.table([[''] ],2400)+'</root>')[0]
 frames[2].replace(paragraph,table);table.find('.//{'+W+'}tc').append(paragraph);frames[2].append(E.Element('{'+W+'}p'))
 parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 return parts
def header(parts):
 parts=dict(parts);root=E.fromstring(parts['word/document.xml']);body=root.find('{'+W+'}body');drawing=body[1];body.remove(drawing)
 hdr=E.Element('{'+W+'}hdr',nsmap=root.nsmap);hdr.append(drawing);parts['word/header1.xml']=E.tostring(hdr,xml_declaration=True,encoding='UTF-8',standalone=True)
 E.SubElement(body.find('{'+W+'}sectPr'),'{'+W+'}headerReference',{'{'+W+'}type':'default','{'+R+'}id':'rHeader'})
 # Section child ordering is normative.
 sect=body.find('{'+W+'}sectPr');sect.insert(0,sect[-1])
 parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 parts['word/_rels/header1.xml.rels']=parts['word/_rels/document.xml.rels']
 rels=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(rels,'{'+rels.nsmap[None]+'}Relationship',Id='rHeader',Type=R+'/header',Target='header1.xml');parts['word/_rels/document.xml.rels']=E.tostring(rels)
 types=E.fromstring(parts['[Content_Types].xml']);E.SubElement(types,'{'+types.nsmap[None]+'}Override',PartName='/word/header1.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml');parts['[Content_Types].xml']=E.tostring(types)
 return parts
if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 parts=build()
 for filename,values in [('control.docx',parts),('structures.docx',structured(parts)),('header.docx',header(parts))]:
  with ZipFile(OUT/filename,'w') as z:
   for name,data in values.items():
    info=ZipInfo(name,(2026,10,4,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
  print(OUT/filename)
