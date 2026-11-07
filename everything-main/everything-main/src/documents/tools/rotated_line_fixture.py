"""Original nested DrawingML line probes, no external artwork or document engine."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WPG='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
cases=[
 ('vertical90',0,72,90,False,False,1,1),('horizontal90',72,0,90,False,False,1,1),
 ('diagonal45',72,36,45,False,False,1,1),('diagonalNegative45',72,36,-45,False,False,1,1),
 ('vertical180',0,72,180,False,False,1,1),('vertical270',0,72,270,False,False,1,1),
 ('horizontal360',72,0,360,False,False,1,1),('diagonal450',72,36,450,False,False,1,1),
 ('flipH30',72,36,30,True,False,1,1),('flipV30',72,36,30,False,True,1,1),
 ('bothFlips30',72,36,30,True,True,1,1),('scaled90',0,72,90,False,False,1.5,.5),
 ('scaled45',72,36,45,False,False,1.5,.5),('nested30',72,36,30,False,False,.75,1.25),
 ('scaled44',72,36,44,False,False,1.5,.5),('scaled46',72,36,46,False,False,1.5,.5),
 ('scaled135',72,36,135,False,False,1.5,.5),('scaled136',72,36,136,False,False,1.5,.5),
 ('scaled224',72,36,224,False,False,1.5,.5),('scaled225',72,36,225,False,False,1.5,.5),
 ('scaled314',72,36,314,False,False,1.5,.5),('scaled315',72,36,315,False,False,1.5,.5),
]
def emu(v):return round(v*12700)
def group(content,x,y,w,h,cw,ch,root=False):
 tag='wgp' if root else 'grpSp'
 return f'<wpg:{tag}><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/><a:chOff x="0" y="0"/><a:chExt cx="{emu(cw)}" cy="{emu(ch)}"/></a:xfrm></wpg:grpSpPr>{content}</wpg:{tag}>'
content=''
for i,(name,w,h,angle,fh,fv,sx,sy) in enumerate(cases):
 x,y=24+(i%2)*240,24+(i//2)*48
 color=f'{32+i*9:02X}{48+i*7:02X}{160-i*5:02X}'
 line=f'<wps:wsp><wps:cNvPr id="{i+1}" name="{name}"/><wps:cNvCnPr/><wps:spPr><a:xfrm rot="{angle*60000}" flipH="{int(fh)}" flipV="{int(fv)}"><a:off x="{emu(24)}" y="{emu(12)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="25400"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:prstDash val="dashDot"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
 if name=='nested30':line=group(line,0,0,160,160,80,80);sx/=2;sy/=2
 content+=group(line,x,y,120*sx,72*sy,120,72)
scene=group(content,0,0,500,600,500,600,True)
drawing=f'<w:r><w:drawing><wp:inline><wp:extent cx="{emu(500)}" cy="{emu(600)}"/><wp:docPr id="100" name="Rotated line probes"/><a:graphic><a:graphicData uri="{WPG}">{scene}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
parts={
 '[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:wpg="{WPG}" xmlns:wps="{WPS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>Rotated line probes</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>{drawing.split("<w:drawing>",1)[1].rsplit("</w:drawing>",1)[0]}</w:drawing></mc:Choice><mc:Fallback><w:t>Drawing fallback</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p><w:p><w:r><w:t>Following paragraph</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
path=ROOT/'public/fixtures/rotated-group-lines.docx'
with ZipFile(path,'w',ZIP_DEFLATED) as archive:
 for name,xml in parts.items():archive.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
print(path)
