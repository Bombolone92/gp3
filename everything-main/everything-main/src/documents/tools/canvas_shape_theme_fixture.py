"""Independently authored theme-matrix/color-transform probe; OPC/XML only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as base, W, R

A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'

def solid(color, modifiers='', scheme=False):
    tag='schemeClr' if scheme else 'srgbClr'
    return f'<a:solidFill><a:{tag} val="{color}">{modifiers}</a:{tag}></a:solidFill>'

def generate():
    parts=dict(base)
    colors=dict(dk1='000000',lt1='FFFFFF',dk2='304050',lt2='EEEEEE',accent1='604333',accent2='BFB6AB',accent3='2266AA',accent4='22AA66',accent5='AA2266',accent6='CC8800',hlink='0000FF',folHlink='800080')
    scheme='<a:clrScheme name="Probe">'+''.join(f'<a:{k}><a:srgbClr val="{v}"/></a:{k}>' for k,v in colors.items())+'</a:clrScheme>'
    fonts='<a:fontScheme name="Probe">'+''.join(f'<a:{k}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:{k}>' for k in ['majorFont','minorFont'])+'</a:fontScheme>'
    fills=solid('phClr',scheme=True)*3
    lines=''.join(f'<a:ln w="{12700*w}" cap="flat" cmpd="sng" algn="ctr">{solid("phClr",scheme=True)}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' for w in [2,4,6])
    fmt=f'<a:fmtScheme name="Probe"><a:fillStyleLst>{fills}</a:fillStyleLst><a:lnStyleLst>{lines}</a:lnStyleLst><a:effectStyleLst>'+('<a:effectStyle><a:effectLst/></a:effectStyle>'*3)+f'</a:effectStyleLst><a:bgFillStyleLst>{fills}</a:bgFillStyleLst></a:fmtScheme>'
    parts['word/theme/probe.xml']=f'<a:theme xmlns:a="{A}" name="Probe"><a:themeElements>{scheme}{fonts}{fmt}</a:themeElements></a:theme>'
    parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="theme" Type="{R}/theme" Target="theme/probe.xml"/></Relationships>')
    parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/theme/probe.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>')
    cases=[
        (solid('accent2','<a:lumMod val="20000"/><a:lumOff val="80000"/>',True),'','<a:shade val="50000"/>'),
        ('','<a:ln w="76200"/>',''),
        (solid('2266AA','<a:shade val="50000"/>'),'<a:ln><a:noFill/></a:ln>',''),
        (solid('2266AA','<a:tint val="50000"/>'),'<a:ln><a:noFill/></a:ln>',''),
        (solid('2266AA','<a:lumMod val="50000"/><a:lumOff val="20000"/>'),'<a:ln><a:noFill/></a:ln>',''),
        (solid('2266AA','<a:lumOff val="20000"/><a:lumMod val="50000"/>'),'<a:ln><a:noFill/></a:ln>',''),
    ]
    body='<w:p><w:r><w:t>Theme shape probe</w:t></w:r></w:p>'
    for i,(fill,line,modifier) in enumerate(cases):
        shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="508000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{fill}{line}</wps:spPr><wps:style><a:lnRef idx="2"><a:schemeClr val="accent1">{modifier}</a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent3"><a:tint val="25000"/></a:schemeClr></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style><wps:bodyPr><a:noAutofit/></wps:bodyPr></wps:wsp>'
        body+=f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{12700*(100+70*i)}</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="508000"/><wp:wrapNone/><wp:docPr id="{i+1}" name="Probe {i}"/><a:graphic><a:graphicData uri="{S}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
    body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}"><w:body>{body}</w:body></w:document>'
    path=Path(__file__).resolve().parents[1]/'public/fixtures/shape-theme.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
    print(path)

if __name__=='__main__':generate()
