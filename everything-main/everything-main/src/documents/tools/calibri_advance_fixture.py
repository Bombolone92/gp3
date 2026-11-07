"""Independent OOXML repeated-letter controls for font size and tracking."""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from hashlib import sha256
import json

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/calibri-advance'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def build():
    cases=[];paragraphs=[]
    for size in [10,36]:
        for bold in [False,True]:
            for spacing in [0,1]:
                case=dict(text='EEEEEEEEEEEE',font='Calibri',sizePt=size,bold=bold,spacingPt=spacing)
                cases.append(case)
                style='<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'
                if bold:style+='<w:b/>'
                style+=f'<w:spacing w:val="{spacing*20}"/><w:kern w:val="0"/><w:sz w:val="{size*2}"/>'
                paragraphs.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr>'+style+'</w:rPr><w:t>'+case['text']+'</w:t></w:r></w:p>')
    parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
           '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
           'word/document.xml':'<w:document xmlns:w="'+W+'"><w:body>'+''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    output=BytesIO()
    with ZipFile(output,'w')as archive:
        for name,content in parts.items():
            info=ZipInfo(name,(2026,10,5,0,0,0));info.create_system=0;info.external_attr=0o600<<16
            archive.writestr(info,content.encode(),compress_type=ZIP_DEFLATED)
    data=output.getvalue();return data,dict(sourceSha256=sha256(data).hexdigest(),cases=cases)
if __name__=='__main__':
    data,reference=build();FOLDER.mkdir(parents=True,exist_ok=True)
    (FOLDER/'control.docx').write_bytes(data)
    (FOLDER/'cases.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf8')
