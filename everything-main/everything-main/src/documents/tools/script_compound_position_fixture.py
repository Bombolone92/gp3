"""Original small-cap/script combination controls; unchanged glyph source."""
from pathlib import Path
import json,struct,argparse
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
from script_position_metrics_fixture import build
from script_vdmx_ppem_fixture import write_controls

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'tests/fixtures/script-compound-position')
    target=parser.parse_args().output;target.mkdir(parents=True,exist_ok=True)
    family='Script Compound Probe'
    font=build(family,{'OS/2':{20:650}},target)
    rows=[dict(size=size,script=script,smallCaps=caps) for size in [12,20]
          for caps in [False,True] for script in ['superscript','subscript']]
    cases=[dict(family=family,rows=rows)]
    write_controls(target,cases,[font.name])
    with ZipFile(target/'controls.docx') as package: parts={n:package.read(n) for n in package.namelist()}
    from xml.etree import ElementTree as ET
    W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    # Preserve independently authored namespace spelling; edit the four script
    # run strings rather than serializing through the viewer's exporter.
    text=parts['word/document.xml'].decode()
    needle='<w:t xml:space="preserve">TEST</w:t>'
    chunks=text.split(needle);assert len(chunks)==len(rows)+1
    rebuilt=chunks[0]
    for i,row in enumerate(rows):
        if row['smallCaps']:
            assert rebuilt.endswith('</w:rPr>')
            rebuilt=rebuilt[:-len('</w:rPr>')]+'<w:smallCaps/></w:rPr>'
            rebuilt+='<w:t xml:space="preserve">test</w:t>'
        else:rebuilt+=needle
        rebuilt+=chunks[i+1]
    parts['word/document.xml']=rebuilt.encode()
    with ZipFile(target/'controls.docx','w',ZIP_DEFLATED) as package:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,1,12,0,0));info.create_system=0;info.external_attr=0o600<<16
            package.writestr(info,data,compress_type=ZIP_DEFLATED)
    print('Authored eight script/small-cap compound rows')
if __name__=='__main__':main()
