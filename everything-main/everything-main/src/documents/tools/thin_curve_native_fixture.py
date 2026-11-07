"""Original textless thin-curve controls for native metafile/bitmap comparison."""
import argparse,json
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
from top_bottom_flow_fixture import make,drawing,paragraph,W,WP,A,PIC,R
from canvas_group_fixture import NS,add,shape


def generate(output):
    output.mkdir(parents=True,exist_ok=False);parts=make(15);cases=[];body=[]
    for pen in [1588,3175,4327,6350]:
        for phase in [0,3175,6350,9525]:
            ident=len(cases)+1
            root=E.fromstring(f'<root xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}" xmlns:wpg="{NS["wpg"]}" xmlns:wps="{NS["wps"]}">{drawing(ident,100,90)}</root>')
            frame=root.find(f'.//{{{WP}}}anchor');frame.set('behindDoc','0');frame.find(f'{{{WP}}}wrapTopAndBottom').tag=f'{{{WP}}}wrapNone'
            for axis,origin in [('H',72),('V',100)]:
                position=frame.find(f'{{{WP}}}position{axis}');position.set('relativeFrom','page');position.find(f'{{{WP}}}posOffset').text=str(origin*12700+phase)
            extent=frame.find(f'{{{WP}}}extent');extent.set('cx',str(240*12700));extent.set('cy',str(90*12700))
            data=root.find(f'.//{{{A}}}graphicData');data.clear();data.set('uri',NS['wpg'])
            group=add(data,'wpg:wgp');add(group,'wpg:cNvGrpSpPr');xf=add(add(group,'wpg:grpSpPr'),'a:xfrm')
            for name,attrs in [('off',dict(x=0,y=0)),('ext',dict(cx=240*12700,cy=90*12700)),('chOff',dict(x=0,y=0)),('chExt',dict(cx=240*12700,cy=90*12700))]:add(xf,'a:'+name,**attrs)
            for index,geometry in enumerate(['rect','ellipse']):
                node=shape(group,ident*10+index,100*12700,60*12700,(10+120*index)*12700,15*12700,'FFFFFF')
                props=node.find('{'+NS['wps']+'}spPr');props.find(f'{{{A}}}prstGeom').set('prst',geometry)
                fill=props.find(f'{{{A}}}solidFill');fill.clear();fill.tag=f'{{{A}}}noFill'
                line=props.find(f'{{{A}}}ln');line.clear();line.set('w',str(pen));line.set('cap','rnd');add(add(line,'a:solidFill'),'a:srgbClr',val='C0C0C0');add(line,'a:round')
            body.append(paragraph(page_break=ident>1,drawings=E.tostring(root[0],encoding='unicode')))
            cases.append({'id':ident,'penEmu':pen,'phaseEmu':phase,'frameOriginPt':[72+phase/12700,100+phase/12700],
                          'shapes':[{'geometry':'rect','boxPt':[10,15,100,60]},{'geometry':'ellipse','boxPt':[130,15,100,60]}]})
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}" xmlns:wpg="{NS["wpg"]}" xmlns:wps="{NS["wps"]}"><w:body>{"".join(body)}</w:body></w:document>'
    with ZipFile(output/'source.docx','x') as archive:
        for name,data in parts.items():
            entry=ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=ZIP_DEFLATED;archive.writestr(entry,data)
    (output/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    generate(parser.parse_args().output)
