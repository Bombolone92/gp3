"""Independent thin, solid-filled DrawingML rectangles at subpixel phases."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from io import BytesIO
from hashlib import sha256
import json
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
G='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'

def build(widths=None, modern=False, grouped_horizontal=False, horizontal=False, grouped=False,group_origin=(0,0)):
    horizontal=horizontal or grouped_horizontal
    grouped=grouped or grouped_horizontal
    cases=[];body=[];children=[]
    for row,width in enumerate(widths or [.375,.75,1.125,1.5]):
        for column,phase in enumerate([0,.1875,.375,.5625]):
            x=54+126*column+(0 if horizontal else phase);y=54+54*row+(phase if horizontal else 0);index=len(cases)+1
            w,h=(18,width) if horizontal else (width,18)
            emu=lambda value:round(value*12700)
            cases.append(dict(index=index,xPt=x,yPt=y,widthPt=w,heightPt=h,xEmu=emu(x),yEmu=emu(y),widthEmu=emu(w),heightEmu=emu(h),color='669748'))
            shape=f'<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="669748"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr><a:noAutofit/></wps:bodyPr></wps:wsp>'
            if grouped:
                children.append(f'<wps:wsp><wps:cNvPr id="{index+100}" name="Independent horizontal {index}"/><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="{emu(x)*2}" y="{emu(y)*3}"/><a:ext cx="{emu(w)*2}" cy="{emu(h)*3}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="669748"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr><a:noAutofit/></wps:bodyPr></wps:wsp>')
            else:
                body.append(f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="{index}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{emu(x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{emu(y)}</wp:posOffset></wp:positionV><wp:extent cx="{emu(w)}" cy="{emu(h)}"/><wp:wrapNone/><wp:docPr id="{index}" name="Independent fill {index}"/><a:graphic><a:graphicData uri="{S}">{shape}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>')
    if grouped:
        group=f'<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu(612)}" cy="{emu(330)}"/><a:chOff x="0" y="0"/><a:chExt cx="{emu(612)*2}" cy="{emu(330)*3}"/></a:xfrm></wpg:grpSpPr>'+''.join(children)+'</wpg:wgp>'
        body=[f'<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{emu(group_origin[0])}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{emu(group_origin[1])}</wp:posOffset></wp:positionV><wp:extent cx="{emu(612)}" cy="{emu(330)}"/><wp:wrapNone/><wp:docPr id="1" name="Independent nonuniform group"/><a:graphic><a:graphicData uri="{G}">{group}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>']
    parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
           '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
           'word/document.xml':f'<w:document xmlns:w="{W}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:wps="{S}"'+(f' xmlns:wpg="{G}"' if grouped else '')+'><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    output=BytesIO()
    if modern:
        parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
        parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
        parts['word/_rels/document.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
    with ZipFile(output,'w')as archive:
        for name,content in parts.items():
            info=ZipInfo(name,(2026,10,5,0,0,0));info.create_system=0;info.external_attr=0o600<<16
            archive.writestr(info,content.encode(),compress_type=ZIP_DEFLATED)
    data=output.getvalue()
    if grouped:
        for case in cases:
            case['xPt']+=group_origin[0];case['yPt']+=group_origin[1]
            case['xEmu']+=emu(group_origin[0]);case['yEmu']+=emu(group_origin[1])
    return data,dict(sourceSha256=sha256(data).hexdigest(),cases=cases)

if __name__=='__main__':
    data,cases=build();folder=ROOT/'tests/fixtures/solid-fill-display';folder.mkdir(parents=True,exist_ok=True)
    (folder/'control.docx').write_bytes(data);(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    data,cases=build([1.1,1.125,1.15,1.875],modern=True)
    (folder/'boundary.docx').write_bytes(data);(folder/'boundary-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    data,cases=build(modern=True,grouped_horizontal=True)
    (folder/'group-horizontal.docx').write_bytes(data);(folder/'group-horizontal-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    for name,options in [('horizontal',dict(horizontal=True)),('group-vertical',dict(grouped=True))]:
        data,cases=build(modern=True,**options)
        (folder/(name+'.docx')).write_bytes(data);(folder/(name+'-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')


    for name,options in [('group-offset-horizontal',dict(horizontal=True)),('group-offset-vertical',dict(horizontal=False))]:
        data,cases=build(modern=True,grouped=True,group_origin=(.35,.35),**options)
        (folder/(name+'.docx')).write_bytes(data);(folder/(name+'-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
