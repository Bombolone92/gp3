"""Original custom-picture clipping controls; our own quadrant PNG and XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
with ZipFile(ROOT / 'public/fixtures/group-picture-flips.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml']); body = root.find(tag('w:body'))
template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr'))); body.clear()
add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='Picture geometry controls')
for i in range(12):
    anchor = deepcopy(template)
    for axis, value in [('H', 60 + 260 * (i % 2)), ('V', 90 + 108 * (i // 2))]:
        anchor.find(tag('wp:position' + axis) + '/' + tag('wp:posOffset')).text = str(value * 12700)
    anchor.set('relativeHeight', str(251658240 + i * 1024))
    nv = anchor.find(tag('wp:docPr')); nv.set('id', str(i+1)); nv.set('name', f'Case {i+1}')
    pic = anchor.find('.//' + tag('pic:pic')); props = pic.find(tag('pic:spPr'))
    props.remove(props.find(tag('a:prstGeom')))
    geom = add(props, 'a:custGeom'); add(geom, 'a:avLst'); guides = add(geom, 'a:gdLst')
    add(guides, 'a:gd', name='middle', fmla='*/ w 1 2')
    add(geom, 'a:ahLst'); add(geom, 'a:cxnLst'); add(geom, 'a:rect', l='l', t='t', r='r', b='b')
    paths = add(geom, 'a:pathLst')
    path = add(paths, 'a:path', w=100, h=100, **({'fill': 'none'} if i == 5 else {}))
    def point(op, x, y): add(add(path, 'a:'+op), 'a:pt', x=x, y=y)
    point('moveTo', 0, 0)
    if i in [0, 6, 7, 8, 9, 10, 11]:
        point('lnTo', 100, 0); point('lnTo', 100, 100); point('lnTo', 0, 100)
    elif i == 3:
        point('lnTo', 100, 0)
        curve = add(path, 'a:cubicBezTo')
        for x,y in [(100,100),(0,100),(0,0)]: add(curve,'a:pt',x=x,y=y)
    elif i == 4:
        point('lnTo', 100, 0); point('lnTo', 100, 100); point('lnTo', 0, 100); add(path,'a:close')
        point('moveTo', 25, 25); point('lnTo', 25, 75); point('lnTo', 75, 75); point('lnTo', 75, 25)
    else:
        point('lnTo', 100, 0); point('lnTo', 0, 100)
    add(path, 'a:close')
    if i == 8:
        for pt in path.iter(tag('a:pt')):
            for axis in ['x', 'y']: pt.set(axis, str(25 + int(pt.get(axis)) // 2))
    if i in [9, 10, 11]:
        second = deepcopy(path); paths.append(second)
        if i == 10:
            for pt in path.iter(tag('a:pt')): pt.set('x', str(int(pt.get('x')) // 4))
            coords = [(75,0),(75,100),(100,100),(100,0)]
        else:
            coords = [(25,25),(25,75),(75,75),(75,25)]
        for pt, (x,y) in zip(second.iter(tag('a:pt')), coords): pt.set('x',str(x));pt.set('y',str(y))
    if i == 11: add(pic.find('.//' + tag('a:blip')), 'a:alphaModFix', amt=50000)
    if i == 2: props.find(tag('a:xfrm')).set('flipH','1')
    if i == 6:
        crop = pic.find(tag('pic:blipFill')+'/'+tag('a:srcRect')); crop.set('l','25000');crop.set('t','12500')
    if i == 7:
        # Same custom geometry as a standalone picture, without group scaling.
        data = anchor.find('.//' + tag('a:graphicData')); data.clear();data.set('uri',NS['pic']);data.append(pic)
        xf=props.find(tag('a:xfrm'));xf.find(tag('a:off')).set('x','0');xf.find(tag('a:off')).set('y','0')
        xf.find(tag('a:ext')).set('cx','1828800');xf.find(tag('a:ext')).set('cy','914400')
    add(add(add(body,'w:p'),'w:r'),'w:drawing').append(anchor)
body.append(section)
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/picture-geometry.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
