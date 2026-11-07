"""Original mixed-limitations DOCX for read-only preview diagnostics."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
paragraphs=['<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Preview feature list</w:t></w:r></w:p>','<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>Directional paragraph</w:t></w:r></w:p>','<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden content</w:t></w:r></w:p>','<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Another hidden run</w:t></w:r></w:p>','<w:p><w:pPr><w:pBdr><w:bottom w:val="wave" w:sz="8" w:space="2" w:color="000000"/></w:pBdr></w:pPr><w:r><w:t>Wave paragraph border</w:t></w:r></w:p>']
body=''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>'}
folder=root/'tests/fixtures/preview-issues';folder.mkdir(exist_ok=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
