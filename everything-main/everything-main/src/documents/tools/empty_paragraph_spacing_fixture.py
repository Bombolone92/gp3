"""Original empty-paragraph spacing controls before a nested table."""
from pathlib import Path
import argparse
import json
import tempfile
from xml.etree import ElementTree as E
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from table_label_context_fixture import generate as context_fixture, node, add, paragraph, table, W


def generate(root):
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        context_fixture(Path(directory))
        with ZipFile(Path(directory) / 'control.docx') as source:
            parts = {n: source.read(n) for n in source.namelist()}
    styles = E.fromstring(parts['word/styles.xml'])
    for size in (20, 21):
        style = add(styles, 'style', type='paragraph', styleId=f'Prefix{size}')
        add(style, 'name', val=f'Prefix {size}')
        add(style, 'basedOn', val='Normal')
        add(add(style, 'pPr'), 'spacing', before=40)
        add(add(style, 'rPr'), 'sz', val=size)
    document = node('document'); body = add(document, 'body'); cases = []
    definitions = [('direct', True, 20), ('direct', False, 20),
                   ('style', False, 20), ('style', True, 20),
                   ('style', False, 21), ('style', True, 21)]
    for index, (formatting, explicit, size) in enumerate(definitions, 1):
        cases.append(dict(page=index, formatting=formatting, explicitLine=explicit, latinSize=size / 2))
        title = paragraph('Case ' + str(index))
        if index > 1:
            title.insert(0, node('pPr')); add(title[0], 'pageBreakBefore')
        body.append(title)
        outer = table(dict(styled=True, height='atLeast', nested=True, explicitSpacing=False, complexSize=False))
        cell = outer.find('.//{' + W + '}tc')
        prefix = next(n for n in cell if n.tag == '{' + W + '}p')
        cell.remove(prefix)
        p = paragraph(); pr = add(p, 'pPr')
        if formatting == 'style':
            add(pr, 'pStyle', val=f'Prefix{size}')
        spacing = add(pr, 'spacing', before=40) if formatting == 'direct' or explicit else None
        if explicit:
            spacing.set('{' + W + '}line', '240'); spacing.set('{' + W + '}lineRule', 'auto')
        if formatting == 'direct':
            add(add(pr, 'rPr'), 'sz', val=size)
        cell.insert(1, p); body.append(outer); body.append(paragraph())
    sect = add(body, 'sectPr'); add(sect, 'pgSz', w=12240, h=15840)
    add(sect, 'pgMar', top=720, right=720, bottom=720, left=720, header=0, footer=0, gutter=0)
    parts['word/document.xml'] = E.tostring(document, encoding='utf-8', xml_declaration=True)
    parts['word/styles.xml'] = E.tostring(styles, encoding='utf-8', xml_declaration=True)
    with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 3, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (root / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
    print(root / 'control.docx')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'tests/fixtures/empty-paragraph-spacing')
    generate(parser.parse_args().output)
