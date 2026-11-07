"""Native scene defaults for the independently authored text-3d control."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E
from text_3d_fixture import ROOT, W, W14


def generate():
    with ZipFile(ROOT / 'control.docx') as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    document = E.fromstring(parts['word/document.xml'])
    body = document.find(f'{{{W}}}body')
    original = list(body)
    section = deepcopy(original[-1])
    body.clear()
    cases = []
    for material in ['warmMatte', 'matte']:
        for rig in [None, 'threePt', 'balanced', 'twoPt']:
            # The base fixture's sixth page is the direct matte bevel case.
            block = [deepcopy(p) for p in original[15:18]]
            name = material + '-' + str(rig)
            block[0].find(f'.//{{{W}}}t').text = name
            if not cases:
                before = block[0].find(f'.//{{{W}}}pageBreakBefore')
                before.getparent().remove(before)
            properties = block[1].find(f'.//{{{W}}}rPr')
            effect = properties.find(f'{{{W14}}}props3d')
            effect.set(f'{{{W14}}}prstMaterial', material)
            if rig:
                scene = E.Element(f'{{{W14}}}scene3d')
                E.SubElement(scene, f'{{{W14}}}camera', {f'{{{W14}}}prst': 'orthographicFront'})
                E.SubElement(scene, f'{{{W14}}}lightRig', {f'{{{W14}}}rig': rig, f'{{{W14}}}dir': 't'})
                properties.insert(list(properties).index(effect), scene)
            body.extend(block)
            cases.append({'page': len(cases)+1, 'name': name, 'material': material, 'rig': rig})
    body.append(section)
    parts['word/document.xml'] = E.tostring(document)
    with ZipFile(ROOT / 'scene-control.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    (ROOT / 'scene-cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    generate()
