"""Original controls for automatic chart plot bounds and axis label sizing."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/chart-layout'
folder.mkdir(parents=True, exist_ok=True)
ns = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
}
cases = [(432, 288, size, 'Arial') for size in (6, 9, 12, 18)] + [(width, height, 9, 'Arial') for width, height in [(288, 288), (504, 288), (432, 216), (432, 360)]]
cases += [(432, 288, size, font) for font in ['Calibri', 'Cambria'] for size in [6, 9, 12, 18]]
cases += [(432, 288, size, font) for font in ['Times New Roman', 'Verdana'] for size in [9, 18]]
cases = [(*case, 'positive') for case in cases]
cases += [(432, 288, size, font, sign) for size, font in [(9, 'Arial'), (18, 'Cambria')] for sign in ['negative', 'mixed']]
for width, height, size, font, sign in cases:
    with ZipFile(root / 'public/fixtures/chart-metadata-basic.docx') as z:
        parts = {name: z.read(name) for name in z.namelist()}
    document = E.fromstring(parts['word/document.xml'])
    for extent in document.findall('.//wp:extent', ns):
        extent.set('cx', str(width * 12700)); extent.set('cy', str(height * 12700))
    chart = E.fromstring(parts['word/charts/chart1.xml'])
    if sign != 'positive':
        for index, series in enumerate(chart.findall('.//c:ser', ns)):
            if sign == 'negative' or index == 0:
                for value in series.findall('c:val/c:numRef/c:numCache/c:pt/c:v', ns):
                    value.text = str(-int(value.text))
    for properties in chart.findall('.//a:defRPr', ns):
        properties.set('sz', str(size * 100))
        latin = properties.find('a:latin', ns)
        if latin is not None: latin.set('typeface', font)
    # Distinct outer/plot strokes give the PDF recorder independent frame edges.
    shape = chart.find('c:spPr', ns)
    line = shape.find('a:ln', ns)
    for child in list(line): line.remove(child)
    fill = E.SubElement(line, '{' + ns['a'] + '}solidFill')
    E.SubElement(fill, '{' + ns['a'] + '}srgbClr', val='FF00FF')
    parts['word/document.xml'] = E.tostring(document)
    parts['word/charts/chart1.xml'] = E.tostring(chart)
    name = f'chart-layout-{width}-{height}-{size}' + ('' if font == 'Arial' else '-' + font.lower().replace(' ', '-'))
    if sign != 'positive': name += '-' + sign
    destination = folder / (name + '.docx')
    if destination.exists():
        with ZipFile(destination) as z:
            if parts == {path: z.read(path) for path in z.namelist()}: continue
    with ZipFile(destination, 'w', ZIP_DEFLATED) as z:
        for path, data in parts.items(): z.writestr(path, data)
