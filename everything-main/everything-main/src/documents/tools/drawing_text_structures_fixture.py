"""Original WPS table/control editing fixture; stdlib, no corpus assets/fonts."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import sys,json
import drawing_text_editing_fixture as base

def control(tag,text,ident,temporary=True):
 run='<w:r>'+base.paragraph(text).split('<w:r>',1)[1].rsplit('</w:p>',1)[0]
 return f'<w:sdt><w:sdtPr><w:alias w:val="{tag}"/><w:tag w:val="{tag}"/><w:id w:val="{ident}"/>'+('<w:temporary/>' if temporary else '')+'<w:showingPlcHdr/></w:sdtPr><w:sdtContent>'+run+'</w:sdtContent></w:sdt>'
def controlled(tag,text,ident,temporary=True):
 return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'+control(tag,text,ident,temporary)+'</w:p>'
def table(rows,width=3000):
 columns=len(rows[0]);cellwidth=width//columns
 return '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="'+str(width)+'"/><w:tblBorders>'+''.join(f'<w:{side} w:val="single" w:sz="4" w:color="406080"/>' for side in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{cellwidth}"/>' for _ in range(columns))+'</w:tblGrid>'+''.join('<w:tr>'+''.join(f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{cellwidth}"/></w:tcPr>'+cell+'</w:tc>' for cell in row)+'</w:tr>' for row in rows)+'</w:tbl>'
def frame(ident,title,content,x=0):
 width=2286000;height=1905000
 return f'<wps:wsp><wps:cNvPr id="{ident}" name="{title}"/><wps:cNvSpPr txBox="1"/><wps:spPr>'+base.transform(width,height,x)+'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="EDF4FA"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>'+base.paragraph(title,True)+content+base.paragraph('End frame')+'</w:txbxContent></wps:txbx><wps:bodyPr lIns="76200" rIns="76200" tIns="38100" bIns="38100" anchor="t" wrap="square"><a:noAutofit/></wps:bodyPr></wps:wsp>'
def drawing(ident,content,width):
 return f'<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{width}" cy="1905000"/><wp:docPr id="{ident}" name="Drawing {ident}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="{base.NS["wps" if ident==1 else "wpg"]}">'+content+'</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
def generate(destination):
 destination.mkdir(parents=True,exist_ok=True)
 from tempfile import TemporaryDirectory
 with TemporaryDirectory() as directory:
  base.ROOT=Path(directory);base.generate()
  with ZipFile(base.ROOT/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 nested=table([[base.paragraph('Nested one')],[base.paragraph('Nested two')]],1200)
 standalone=frame(101,'Standalone table',table([[base.paragraph('First cell'),controlled('temp-table','Prompt A',201)],[controlled('persistent-table','Persistent A',202,False),base.paragraph('Outer cell')+nested+base.paragraph('After nested')]]))
 group='<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>'+base.transform(4572000,1905000,group=True)+'</wpg:grpSpPr>'+frame(102,'Grouped table',table([[base.paragraph('Group cell'),base.paragraph('Group neighbor')]]))+frame(103,'Controlled frame',controlled('temp-frame','Prompt B',203)+base.paragraph('Plain neighbor'),2286000)+'</wpg:wgp>'
 parts['word/document.xml']=(f'<w:document {base.DECL} mc:Ignorable="wps wpg"><w:body>'+base.paragraph('Before drawings')+drawing(1,standalone,2286000)+base.paragraph('Between drawings')+drawing(2,group,4572000)+base.paragraph('After drawings')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
 with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as z:
  for n,value in parts.items():z.writestr(n,value)
 (destination/'cases.json').write_text(json.dumps({'scope':'Original standalone/grouped WPS tables, nested table and inline temporary/persistent controls','tags':['temp-table','persistent-table','temp-frame'],'edits':{'First cell':'Edited cell','Prompt A':'Filled prompt','Persistent A':'Kept value','Nested two':'Nested edited','Group cell':'Group edited','Prompt B':'Filled frame'}},indent=2)+'\n')
 print(destination/'control.docx')
if __name__=='__main__':generate(Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'tests/fixtures/drawing-text-structures')
