"""Original base, inherited and conditional table styles versus direct direction."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(folder / 'origins.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(W + 'body')
template, section = deepcopy(body.find(W + 'tbl')), deepcopy(body[-1])
body.clear()
for index_case, kind in enumerate(['Conditional', 'Base', 'Inherited', 'Direct']):
    direct = kind == 'Direct'
    p = E.SubElement(body, W + 'p')
    if index_case:
        E.SubElement(E.SubElement(p, W + 'pPr'), W + 'pageBreakBefore')
    E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = kind
    table = deepcopy(template)
    properties = table.find(W + 'tblPr')
    if not direct:
        properties.insert(0, E.Element(W + 'tblStyle', {W + 'val': kind}))
    E.SubElement(properties, W + 'tblLook', {W + 'firstRow': '1', W + 'lastRow': '1', W + 'noHBand': '1', W + 'noVBand': '1'})
    row = table.find(W + 'tr')
    table.remove(row)
    for index in range(3):
        current = deepcopy(row)
        for column, cell in enumerate(current.findall(W + 'tc')):
            properties = cell.find(W + 'tcPr')
            properties.remove(properties.find(W + 'textDirection'))
            direction = ['tbRl', 'lrTb', 'btLr'][index]
            override = index in [0, 1] and column == 1
            if override:
                direction = 'lrTb' if index == 0 else 'tbRl'
            if direct or override:
                properties.insert(len(properties) - 1, E.Element(W + 'textDirection', {W + 'val': direction}))
            run = cell.find(W + 'p').find(W + 'r')
            for child in list(run):
                if child.tag != W + 'rPr':
                    run.remove(child)
            E.SubElement(run, W + 't').text = f'R{index + 1}C{column + 1}'
        table.append(current)
    body.append(table)
body.append(section)
styles = E.fromstring(parts['word/styles.xml'])
style = E.SubElement(styles, W + 'style', {W + 'type': 'table', W + 'styleId': 'Conditional'})
E.SubElement(style, W + 'name', {W + 'val': 'Conditional'})
for region, direction in [('firstRow', 'tbRl'), ('lastRow', 'btLr')]:
    region = E.SubElement(style, W + 'tblStylePr', {W + 'type': region})
    E.SubElement(E.SubElement(region, W + 'tcPr'), W + 'textDirection', {W + 'val': direction})
style = E.SubElement(styles, W + 'style', {W + 'type': 'table', W + 'styleId': 'Base'})
E.SubElement(style, W + 'name', {W + 'val': 'Base'})
E.SubElement(E.SubElement(style, W + 'tcPr'), W + 'textDirection', {W + 'val': 'btLr'})
style = E.SubElement(styles, W + 'style', {W + 'type': 'table', W + 'styleId': 'Inherited'})
E.SubElement(style, W + 'name', {W + 'val': 'Inherited'})
E.SubElement(style, W + 'basedOn', {W + 'val': 'Base'})
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
parts['word/styles.xml'] = E.tostring(styles, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / 'styles.docx', 'w', ZIP_DEFLATED) as output:
    for name, data in parts.items():
        output.writestr(name, data)
