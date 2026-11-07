"""Independently authored OOXML controls for br/@clear beside square floats."""
import argparse
import json
from pathlib import Path
from manual_break_wrapping_fixture import drawing, paragraph, run, make, write, NS, R

DEFAULT = Path(__file__).resolve().parents[1] / 'tests/fixtures/clearing-break-wrapping'


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    cases, body = [], []
    for placement, frames in [('left', [(0, 40)]), ('middle', [(180, 40)]),
                              ('right', [(368, 40)]), ('both', [(0, 20), (368, 60)])]:
        for clear in ['none', 'left', 'right', 'all']:
            index = len(cases)
            cases.append(dict(index=index, placement=placement, clear=clear, frames=frames))
            floats = ''
            for number, (x, height) in enumerate(frames):
                image = drawing(index*10+number+1, 0, height)
                image = image.replace('<wp:wrapTopAndBottom/>', '<wp:wrapSquare wrapText="bothSides"/>')
                image = image.replace('<wp:posOffset>0</wp:posOffset></wp:positionH>',
                                      f'<wp:posOffset>{x*12700}</wp:posOffset></wp:positionH>')
                floats += image
            body.append(paragraph(f'CASE {index}', page_break=index > 0))
            content = floats + run(f'FIRST {index}') + run(contents=f'<w:br w:clear="{clear}"/>') + run(f'SECOND {index}')
            body.append(paragraph(drawings=content))
            body.append(paragraph(f'FOLLOW {index}', before=40))
    parts = make(15)
    section = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/>'
    parts['word/document.xml'] = f'<w:document {NS}><w:body>{"".join(body)}<w:sectPr>{section}</w:sectPr></w:body></w:document>'
    write(output/'body.docx', parts)
    (output/'cases.json').write_text(json.dumps(cases, indent=2)+'\n')
    for story, tag in [('header', 'hdr'), ('footer', 'ftr')]:
        parts = make(15)
        content = []
        for index, clear in enumerate(['none', 'left', 'right', 'all']):
            image = drawing(index+1, 0, 40).replace('<wp:wrapTopAndBottom/>', '<wp:wrapSquare wrapText="bothSides"/>')
            image = image.replace('<wp:posOffset>0</wp:posOffset></wp:positionH>', '<wp:posOffset>2286000</wp:posOffset></wp:positionH>')
            content.append(paragraph(f'CASE {index}', before=1200 if index else 0))
            content.append(paragraph(drawings=image+run(f'FIRST {index}')+run(contents=f'<w:br w:clear="{clear}"/>')+run(f'SECOND {index}')))
            content.append(paragraph(f'FOLLOW {index}', before=40))
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/{story}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{story}+xml"/></Types>')
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="story" Type="{R}/{story}" Target="{story}.xml"/></Relationships>')
        parts[f'word/_rels/{story}.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="{R}/image" Target="media/panel.png"/></Relationships>'
        parts[f'word/{story}.xml'] = f'<w:{tag} {NS}>{"".join(content)}</w:{tag}>'
        parts['word/document.xml'] = f'<w:document {NS}><w:body>{paragraph("BODY")}<w:sectPr><w:{story}Reference w:type="default" r:id="story"/>{section}</w:sectPr></w:body></w:document>'
        write(output/f'{story}.docx', parts)
    parts = make(15)
    boundary = []
    for index, height in enumerate([60, 80]):
        image = drawing(index+1, 0, height).replace('<wp:wrapTopAndBottom/>', '<wp:wrapSquare wrapText="bothSides"/>')
        boundary.append(paragraph(f'CASE {index}', page_break=index > 0))
        boundary.append(paragraph().replace('w:line="240" w:lineRule="auto"', 'w:line="11400" w:lineRule="exact"'))
        anchored = paragraph(drawings=image+run(f'FIRST {index}')+run(contents='<w:br w:clear="all"/>')+run(f'SECOND {index}'))
        anchored = anchored.replace('<w:spacing', '<w:widowControl w:val="0"/><w:spacing')
        boundary.append(anchored)
        boundary.append(paragraph(f'FOLLOW {index}', before=40))
    parts['word/document.xml'] = f'<w:document {NS}><w:body>{"".join(boundary)}<w:sectPr>{section}</w:sectPr></w:body></w:document>'
    write(output/'boundary.docx', parts)
    legacy = make(12)
    legacy['word/document.xml'] = parts['word/document.xml']
    write(output/'boundary-legacy.docx', legacy)
    no_clear = parts['word/document.xml'].replace('w:clear="all"', 'w:clear="none"')
    for mode, name in [(15, 'edge-none'), (12, 'edge-none-legacy')]:
        parts = make(mode)
        parts['word/document.xml'] = no_clear
        write(output/f'{name}.docx', parts)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT)
    build(parser.parse_args().output)
