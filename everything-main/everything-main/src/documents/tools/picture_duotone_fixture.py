"""Original OPC/XML and PNG controls for DrawingML duotone; stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct, zlib, json
from canvas_first_section_fixture import parts, W, R, REL
ROOT = Path(__file__).resolve().parents[1]
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
colors = [(0,0,0,255),(64,64,64,255),(128,128,128,255),(192,192,192,255),(255,255,255,255),(255,0,0,255),(0,255,0,255),(0,0,255,255),(0,255,255,255),(255,0,255,255),(255,255,0,255),(200,40,80,255),(200,40,80,128),(200,40,80,64),(200,40,80,0),(17,119,221,255)]
def chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
rows = b''.join(b'\0'+b''.join(bytes(c)*8 for c in colors) for _ in range(16))
png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',128,16,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
def rgb(value, modifiers=''):
    return f'<a:srgbClr val="{value}">{modifiers}</a:srgbClr>'
def duo(a, b):
    return '<a:duotone>'+a+b+'</a:duotone>'
bw = duo(rgb('000000'),rgb('FFFFFF'))
red = duo(rgb('CC2244'),rgb('FFFFFF'))
cases = [('', 'Original'),(bw,'Black white'),(duo(rgb('FFFFFF'),rgb('000000')),'White black'),(red,'Red white'),(duo(rgb('123456'),rgb('EEDD88')),'Blue gold'),(duo(rgb('000000','<a:alpha val="0"/>'),rgb('FFFFFF')),'Transparent dark'),(duo(rgb('000000'),rgb('FFFFFF','<a:alpha val="50000"/>')),'Half light'),(bw+red,'Repeated'),('<a:alphaModFix amt="50000"/>'+red,'Alpha before'),(red+'<a:alphaModFix amt="50000"/>','Alpha after')]
cases += [(red+bw,'Red then grayscale')]
for value in [0,50000,135000,200000,-50000]:
    cases.append((duo(rgb('EA2F32',f'<a:shade val="45000"/><a:satMod val="{value}"/>'),'<a:prstClr val="white"/>'),f'Saturation {value}'))
cases.append((duo('<a:schemeClr val="accent3"><a:shade val="45000"/><a:satMod val="135000"/></a:schemeClr>','<a:prstClr val="white"/>'),'Theme shade saturation'))
body='<w:p><w:r><w:t>Duotone controls</w:t></w:r></w:p>'
for i,(effect,label) in enumerate(cases):
    drawing=f'<w:r><w:drawing><wp:inline><wp:extent cx="3657600" cy="457200"/><wp:docPr id="{i+1}" name="D{i:02}"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="{i+1}" name="D{i:02}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image">{effect}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3657600" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    body+=f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>D{i:02} {label}</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>{drawing}</w:p>'
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>')
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="image" Type="{R}/image" Target="media/duotone.png"/></Relationships>')
parts['word/media/duotone.png']=png
palette={'dk1':'000000','lt1':'FFFFFF','dk2':'223344','lt2':'EEEEEE','accent1':'114488','accent2':'44AA77','accent3':'EA2F32','accent4':'AA44AA','accent5':'33AAAA','accent6':'EEAA33','hlink':'0000FF','folHlink':'800080'}
scheme=''.join(f'<a:{name}><a:srgbClr val="{value}"/></a:{name}>' for name,value in palette.items())
fonts=''.join(f'<a:{name}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:{name}>' for name in ['majorFont','minorFont'])
solid='<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
parts['word/theme/theme1.xml']=f'<a:theme xmlns:a="{A}" name="Duotone control"><a:themeElements><a:clrScheme name="Control">{scheme}</a:clrScheme><a:fontScheme name="Control">{fonts}</a:fontScheme><a:fmtScheme name="Control"><a:fillStyleLst>{solid*3}</a:fillStyleLst><a:lnStyleLst>{("<a:ln w=\"12700\">"+solid+"</a:ln>")*3}</a:lnStyleLst><a:effectStyleLst>{("<a:effectStyle><a:effectLst/></a:effectStyle>")*3}</a:effectStyleLst><a:bgFillStyleLst>{solid*3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>')
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="theme" Type="{R}/theme" Target="theme/theme1.xml"/></Relationships>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="31680"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(ROOT/'public/fixtures/picture-duotone.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
folder=ROOT/'tests/fixtures/picture-duotone';folder.mkdir(exist_ok=True)
(folder/'cases.json').write_text(json.dumps(dict(colors=colors,cases=[dict(id=f'D{i:02}',label=label,effect=effect) for i,(effect,label) in enumerate(cases)]),indent=2)+'\n')
