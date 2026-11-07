from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
S='<w:proofErr w:type="spellStart"/>';E='<w:proofErr w:type="spellEnd"/>'
def run(text, extra=''):
    return f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/>{extra}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
cases={
 'accepted':f'<w:p>{S}{run("jumped")}{E}</w:p>',
 'orphan-start':f'<w:p>{S}{run("jumpd")}</w:p>',
 'orphan-end':f'<w:p>{run("jumpd")}{E}</w:p>',
 'double-start':f'<w:p>{S}{run("jumpd ")}{S}{run("wrng")}{E}</w:p>',
 'cross-paragraph':f'<w:p>{S}{run("jumpd")}</w:p><w:p>{run("wrng")}{E}</w:p>',
 'partial':f'<w:p>{S}{run("jum")}{E}{run("pd")}</w:p>',
 'exempt':f'<w:p>{S}{run("jumpd", "<w:noProof/>")}{E}</w:p>',
 'grammar-only':f'<w:p><w:proofErr w:type="gramStart"/>{run("jumpd")}<w:proofErr w:type="gramEnd"/></w:p>',
 'utf16':f'<w:p>{run("😀 ")}{S}{run("jumpd")}{E}</w:p>',
}
import argparse
parser=argparse.ArgumentParser(description='Hand-authored saved spelling ranges; no document engine or font programs.')
parser.add_argument('--output-folder', type=Path, default=Path(__file__).resolve().parents[1]/'tests/fixtures/cached-proofing')
folder=parser.parse_args().output_folder;folder.mkdir(parents=True,exist_ok=True)
with ZipFile(Path(__file__).resolve().parents[1]/'tests/fixtures/proofing-state/proofing-clean.docx') as z:base={n:z.read(n) for n in z.namelist()}
document=base['word/document.xml'].decode();start=document.index('<w:p>');end=document.index('</w:p>')+len('</w:p>')
for name,content in cases.items():
    parts={**base,'word/document.xml':(document[:start]+content+document[end:]).encode()}
    with ZipFile(folder/f'{name}.docx','w',ZIP_DEFLATED) as z:
        for path,data in parts.items():
            info=ZipInfo(path,(2026,10,10,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
(folder/'cases.json').write_text(json.dumps(list(cases),indent=2)+'\n',encoding='utf-8')
