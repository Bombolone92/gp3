"""Original continuous-section controls; export the generated sources with the reference application for references."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.etree import ElementTree as E
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';E.register_namespace('w',W)
def add(p,tag,**a):return E.SubElement(p,'{'+W+'}'+tag,{'{'+W+'}'+k:str(v) for k,v in a.items()})
def sect(p,columns,kind):
 s=add(p,'sectPr');add(s,'type',val=kind);add(s,'pgSz',w=6120,h=7920);add(s,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0);add(s,'cols',num=columns,space=360);return s
def para(body,text,breakBefore=False):
 p=add(body,'p');pp=add(p,'pPr');add(pp,'spacing',before=0,after=0,line=240,lineRule='exact');r=add(p,'r');rp=add(r,'rPr');add(rp,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,'sz',val=20)
 if breakBefore:add(r,'br',type='column')
 add(r,'t').text=text
 return pp
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'public/fixtures/exhausted-cell-indents.docx'
with ZipFile(base) as z:parts0={n:z.read(n) for n in z.namelist()}
for case,count,explicit in [('balanced',10,False),('explicit',10,True),('overflow',80,False)]:
 parts=parts0.copy();root=E.Element('{'+W+'}document');body=add(root,'body')
 for i in range(3):pp=para(body,f'Intro {i+1}')
 sect(pp,1,'nextPage')
 for i in range(count):pp=para(body,f'Column {i+1:02}',explicit and i==4)
 sect(pp,2,'continuous')
 para(body,'After columns');sect(body,1,'continuous')
 parts['word/document.xml']=E.tostring(root)
 with ZipFile(ROOT/f'tests/fixtures/continuous-sections/{case}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)

for case in ['one','table','keep','stories']:
 parts=parts0.copy();root=E.Element('{'+W+'}document');body=add(root,'body')
 for i in range(3):pp=para(body,f'Intro {i+1}')
 first=sect(pp,1,'nextPage')
 if case=='table':
  t=add(body,'tbl');pr=add(t,'tblPr');add(pr,'tblW',w=2160,type='dxa');add(pr,'tblLayout',type='fixed')
  mar=add(pr,'tblCellMar')
  for side in ['top','left','bottom','right']:add(mar,side,w=0,type='dxa')
  grid=add(t,'tblGrid');add(grid,'gridCol',w=2160)
  for i in range(10):
   tr=add(t,'tr');tc=add(tr,'tc');tcp=add(tc,'tcPr');add(tcp,'tcW',w=2160,type='dxa');para(tc,f'Row {i+1:02}')
  pp=para(body,'')
 else:
  for i in range(1 if case=='one' else 10):
   pp=para(body,f'Column {i+1:02}')
   if case=='keep' and i<6:pp.insert(0,E.Element('{'+W+'}keepNext'))
 second=sect(pp,2,'continuous')
 para(body,'After columns')
 third=sect(body,1,'continuous')
 if case=='stories':
  R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  relname='word/_rels/document.xml.rels';rels=E.fromstring(parts[relname]);ct=E.fromstring(parts['[Content_Types].xml'])
  for i,s in enumerate([first,second,third],1):
   h=E.Element('{'+W+'}hdr');para(h,f'Header {i}')
   parts[f'word/header{i}.xml']=E.tostring(h)
   ref=E.Element('{'+W+'}headerReference',{'{'+W+'}type':'default','{'+R+'}id':f'header{i}'})
   s.insert(0,ref)
   E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':f'header{i}','Type':R+'/header','Target':f'header{i}.xml'})
   E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',{'PartName':f'/word/header{i}.xml','ContentType':'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'})
  parts[relname]=E.tostring(rels);parts['[Content_Types].xml']=E.tostring(ct)
 parts['word/document.xml']=E.tostring(root)
 with ZipFile(ROOT/f'tests/fixtures/continuous-sections/{case}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)

for case,count in [('full',27),('tight',26)]:
 parts=parts0.copy();root=E.Element('{'+W+'}document');body=add(root,'body')
 for i in range(count):pp=para(body,f'Intro {i+1:02}')
 sect(pp,1,'nextPage')
 for i in range(10):pp=para(body,f'Column {i+1:02}')
 sect(pp,2,'continuous')
 para(body,'After columns');sect(body,1,'continuous')
 parts['word/document.xml']=E.tostring(root)
 with ZipFile(ROOT/f'tests/fixtures/continuous-sections/{case}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
with ZipFile(ROOT/'tests/fixtures/continuous-sections/overflow.docx') as z:parts={n:z.read(n) for n in z.namelist()}
with ZipFile(ROOT/'tests/fixtures/continuous-sections/stories.docx') as z:stories={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);other=E.fromstring(stories['word/document.xml'])
for s,source in zip(root.iter('{'+W+'}sectPr'),other.iter('{'+W+'}sectPr')):s.insert(0,next(source.iter('{'+W+'}headerReference')))
parts['word/document.xml']=E.tostring(root)
for n,b in stories.items():
 if 'header' in n or n in ['[Content_Types].xml','word/_rels/document.xml.rels']:parts[n]=b
with ZipFile(ROOT/'tests/fixtures/continuous-sections/stories-overflow.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
