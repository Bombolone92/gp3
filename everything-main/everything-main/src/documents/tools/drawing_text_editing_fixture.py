"""Independent retained drawing text-edit controls; original OOXML, stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/drawing-text-editing'
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape','wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup','mc':'http://schemas.openxmlformats.org/markup-compatibility/2006'}
DECL=' '.join(f'xmlns:{k}="{v}"' for k,v in NS.items())
def paragraph(text,bold=False):
 return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>'+('<w:b/>' if bold else '')+'</w:rPr><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r></w:p>'
def transform(width,height,x=0,y=0,group=False):
 return f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/>'+ (f'<a:chOff x="0" y="0"/><a:chExt cx="{width}" cy="{height}"/>' if group else '')+'</a:xfrm>'
def shape(ident,label,x=0,width=1524000,height=762000):
 return f'<wps:wsp><wps:cNvPr id="{ident}" name="{escape(label)}"/><wps:cNvSpPr txBox="1"/><wps:spPr>'+transform(width,height,x)+'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DDEEFF"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>'+paragraph(label,True)+paragraph('Original second paragraph')+'</w:txbxContent></wps:txbx><wps:bodyPr lIns="76200" rIns="76200" tIns="38100" bIns="38100" anchor="t" wrap="square"><a:noAutofit/></wps:bodyPr></wps:wsp>'
def drawing(ident,group=False):
 width=3048000 if group else 1524000; height=762000
 content=('<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>'+transform(width,height,group=True)+'</wpg:grpSpPr>'+shape(ident+100,'Left grouped title')+shape(ident+101,'Right grouped title',1524000)+'</wpg:wgp>') if group else shape(ident+100,'Standalone title')
 return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'+f'<wp:extent cx="{width}" cy="{height}"/><wp:docPr id="{ident}" name="Drawing {ident}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="{NS["wpg" if group else "wps"]}">'+content+'</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
def generate():
 ROOT.mkdir(parents=True,exist_ok=True)
 parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'}
 parts['word/document.xml']=f'<w:document {DECL} mc:Ignorable="wps wpg"><w:body>'+paragraph('Before drawings')+drawing(1)+paragraph('Between drawings')+drawing(2,True)+paragraph('After drawings')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
 with ZipFile(ROOT/'control.docx','w',ZIP_DEFLATED) as z:
  for name,value in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+value)
 (ROOT/'cases.json').write_text(json.dumps({'scope':'Original standalone and grouped WPS text frames; no corpus artwork or font programs.','bodyText':['Before drawings','Between drawings','After drawings'],'textFrames':[{'drawingId':1,'shapeId':101,'title':'Standalone title'},{'drawingId':2,'shapeId':102,'title':'Left grouped title'},{'drawingId':2,'shapeId':103,'title':'Right grouped title'}]},indent=2)+'\n')
 print(ROOT/'control.docx')
if __name__=='__main__':generate()
