"""Independent wrapped-picture stacking controls, authored as OPC/XML and PNG."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json,struct,zlib
from canvas_anchor_position_fixture import make,W,WP,A,PIC,R
root=Path(__file__).resolve().parents[1]/'tests/fixtures/wrapped-behind';root.mkdir(exist_ok=True)
parts=make(15)
def png(color):
 def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes(color)*16)*16))+chunk(b'IEND',b'')
parts['word/media/red.png']=png([220,40,40])
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="red" Type="{R}/image" Target="media/red.png"/></Relationships>')
def drawing(i,base,x,wrap,behind,picture,order):
 return f'''<w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{order}" behindDoc="{int(behind)}" locked="0" layoutInCell="1" allowOverlap="1" distT="0" distB="0" distL="0" distR="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="{base}"><wp:posOffset>{x*12700}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>177800</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:{wrap}{' wrapText="bothSides"' if wrap=='wrapSquare' else ''}/><wp:docPr id="{i}" name="Picture {i}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="panel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{picture}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'''
cases=[];body=[]
for wrap,base in [('wrapTopAndBottom','column'),('wrapTopAndBottom','page'),('wrapTopAndBottom','margin'),('wrapSquare','column')]:
 for behind in [False,True]:
  i=len(cases);cases.append(dict(id=i,wrap=wrap,base=base,behind=behind))
  ppr=('<w:pageBreakBefore/>' if i else '')+'<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>'
  text=f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>ANCHOR {i}</w:t></w:r>'
  body.append(f'<w:p><w:pPr>{ppr}</w:pPr>{text}'+drawing(i*2+1,base,72 if base=='page' else 0,wrap,behind,'picture',0)+drawing(i*2+2,'column',18,'wrapNone',False,'red',1)+'</w:p>')
  body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>FOLLOW {i} text beside or below the pictures.</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for name,value in parts.items():z.writestr(name,value)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
