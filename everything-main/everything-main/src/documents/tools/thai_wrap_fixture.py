"""Original manual OOXML controls for line breaks between Thai and Lao words."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
import json
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root/'public/fixtures/table-shading-scope.docx') as z:parts={n:z.read(n) for n in z.namelist()}
# Each case lists its source runs; a run boundary inside a word is not a break.
cases=[
 ('thai',150,['ฉันไปโรงเรียนทุกวันเพราะอยากเรียนรู้เรื่องใหม่ๆเสมอ ผมชอบกินข้าวผัดกะเพราไก่ไข่ดาวมากที่สุดในโลก']),
 ('split-run',120,['วันนี้ฉันไปโรงเ','รียนแต่เช้าเพราะต้องสอบ']),
 ('mixed',140,['ฉันชอบอ่านหนังสือ Python และ JavaScript ทุกวัน, ไม่เคยเบื่อเลย']),
 ('lao',140,['ຂ້ອຍໄປໂຮງຮຽນທຸກມື້ເພາະຢາກຮຽນຮູ້ສິ່ງໃໝ່ໆສະເໝີ']),
]
body=[]
for i,(name,width,runs) in enumerate(cases):
    body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>CASE {name}</w:t></w:r></w:p>')
    text=''.join(f'<w:r><w:t xml:space="preserve">{escape(s)}</w:t></w:r>' for s in runs)
    body.append(f'<w:p><w:pPr><w:ind w:right="{(504-width)*20}"/></w:pPr>{text}</w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(root/'public/fixtures/thai-wrap.docx','w',ZIP_DEFLATED) as z:
    for n,d in parts.items():z.writestr(n,d)
folder=root/'tests/fixtures/thai-wrap';folder.mkdir(exist_ok=True)
(folder/'cases.json').write_text(json.dumps([dict(name=n,width=w,runs=r) for n,w,r in cases],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
