"""Original XML control for the unspecified non-complex font size."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED

from canvas_first_section_fixture import parts as shell,W
parts=dict(shell)
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'
body=''.join(f'<w:p><w:r>{pr}<w:t>{label} Sample text</w:t></w:r></w:p>' for label,pr in [('Unspecified',''),('Explicit10','<w:rPr><w:sz w:val="20"/></w:rPr>'),('Explicit12','<w:rPr><w:sz w:val="24"/></w:rPr>')])
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).resolve().parents[1]/'public/fixtures/default-run-size.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

