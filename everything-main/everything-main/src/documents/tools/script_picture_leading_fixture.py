"""Manually authored controls for script formatting on inline picture runs."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from io import BytesIO
from html import escape
import argparse,json
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'tests/fixtures/script-picture-leading')
    folder=parser.parse_args().output;folder.mkdir(parents=True,exist_ok=True)
    cases=[];body=[]
    def properties(family,size,script='baseline'):
        return f'<w:rFonts w:ascii="{escape(family)}" w:hAnsi="{escape(family)}"/><w:sz w:val="{size*2}"/><w:vertAlign w:val="{script}"/>'
    def run(text,props):return '<w:r><w:rPr>'+props+'</w:rPr><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'
    label=properties('Arial',10)
    for family,size in [('Arial',12),('Trebuchet MS',11),('Garamond',12)]:
        for mixed in [False,True]:
            for multiple in [259,360]:
                for script in ['baseline','superscript','subscript']:
                    index=len(cases);name=f'C{index:02d}'
                    cases.append(dict(name=name,family=family,size=size,mixed=mixed,multiple=multiple,script=script))
                    body.append('<w:p><w:pPr>'+('<w:pageBreakBefore/>' if index else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>'+run(name,label)+'</w:p>')
                    props=properties(family,size,script);mark=properties('Arial',6) if mixed else props
                    before=run('Left ',properties('Arial',6)) if mixed else ''
                    after=run(' Right',properties('Arial',6)) if mixed else ''
                    picture=f'''<w:r><w:rPr>{props}</w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="457200" cy="914400"/><wp:docPr id="{index+1}" name="{name}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Original red rectangle"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''
                    body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="{multiple}" w:lineRule="auto"/><w:rPr>{mark}</w:rPr></w:pPr>'+before+picture+after+'</w:p>')
                    body.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>'+run('After',label)+'</w:p>')
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    ns='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    png=BytesIO();Image.new('RGB',(36,72),(255,0,0)).save(png,format='PNG')
    parts={
        '[Content_Types].xml':b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels':b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml':('<w:document '+ns+'><w:body>'+''.join(body)+'</w:body></w:document>').encode(),
        'word/_rels/document.xml.rels':b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/red.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/settings.xml':b'<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
        'word/media/red.png':png.getvalue(),
    }
    with ZipFile(folder/'controls.docx','w',ZIP_DEFLATED) as package:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,1,12,0,0));info.create_system=0;info.external_attr=0o600<<16
            package.writestr(info,data,compress_type=ZIP_DEFLATED)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',newline='\n')
    print('Authored',len(cases),'script-picture leading controls')
if __name__=='__main__':main()
