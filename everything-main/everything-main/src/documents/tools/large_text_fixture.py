"""Manually authored original DOCX beyond the former 100,000-character cap."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import argparse,hashlib,json

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'

def generate(out):
    out.mkdir(parents=True,exist_ok=True)
    paragraphs=[(f'Paragraph {n:03d}: '+('Original large document editing control. '*30))[:1000] for n in range(1,121)]
    body=''.join(f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{p}</w:t></w:r></w:p>' for p in paragraphs)
    parts={
      '[Content_Types].xml':f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>',
      'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"/>',
    }
    with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
        for name,text in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,text.encode())
    meta=dict(characters=len('\n'.join(paragraphs)),paragraphs=len(paragraphs),sourceSha256=hashlib.sha256((out/'control.docx').read_bytes()).hexdigest())
    (out/'reference.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
    return meta

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    print(json.dumps(generate(parser.parse_args().output)))
