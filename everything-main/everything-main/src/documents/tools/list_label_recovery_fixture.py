"""Original OOXML controls for list-label recovery and retained counter progression."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base
OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/list-label-recovery'
def main():
    base.OUT = OUT; base.build(False)
    with ZipFile(OUT / 'healthy.docx') as z: parts = {n: z.read(n) for n in z.namelist()}
    def item(text, num): return base.p(text, f'<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num}"/></w:numPr></w:pPr>')
    body = item('Healthy first', 1) + item('Unsupported label only', 2) + item('Healthy second', 1) + item('Shared counter continues', 3)
    original = base.p('Numbered item', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>')
    for name, fmt, text in [('unsupported', 'upperRoman', '%1.'), ('healthy', 'none', '')]:
        current = dict(parts)
        current['word/document.xml'] = current['word/document.xml'].decode().replace(original, body).encode()
        abstract = f'<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="4000"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
        instances = '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="4000"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:lvlOverride></w:num>'
        numbering = current['word/numbering.xml'].decode().replace('<w:num w:numId="1">', abstract + '<w:num w:numId="1">').replace('</w:numbering>', instances + '</w:numbering>')
        current['word/numbering.xml'] = numbering.encode()
        with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for path, data in current.items(): z.writestr(path, data)
    for name in ['healthy', 'unsupported']:
        with ZipFile(OUT / (name + '.docx')) as z: current = {n: z.read(n) for n in z.namelist()}
        moved = item('Unsupported label only', 2) + item('Shared counter continues', 3)
        current['word/document.xml'] = current['word/document.xml'].decode().replace(item('Unsupported label only', 2), '').replace(item('Shared counter continues', 3), '').encode()
        current['word/header1.xml'] = current['word/header1.xml'].decode().replace('</w:hdr>', moved + '</w:hdr>').encode()
        with ZipFile(OUT / ('header-' + name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for path, data in current.items(): z.writestr(path, data)
if __name__ == '__main__': main()
