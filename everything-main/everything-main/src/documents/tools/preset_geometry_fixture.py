"""Original OOXML control for straight-edged preset geometries (ECMA-376 §20.1.10.56): diamond,
parallelogram, trapezoid, pentagon, plus, right/left/up/left-right arrows and 4-point star, each floating
with a solid fill and outline, once with default and once with explicit adjustments. Stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W

WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
PRESETS = [('diamond', []), ('parallelogram', [('adj', 40000)]), ('trapezoid', [('adj', 30000)]), ('pentagon', []), ('plus', [('adj', 35000)]),
           ('rightArrow', [('adj1', 60000), ('adj2', 40000)]), ('leftArrow', []), ('upArrow', [('adj1', 30000)]), ('leftRightArrow', []), ('star4', [('adj', 20000)])]

def shape(index, preset, adjustments, x, y):
    gd = ''.join(f'<a:gd name="{name}" fmla="val {value}"/>' for name, value in adjustments)
    return (f'<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{index}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
            f'<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>{y}</wp:posOffset></wp:positionV>'
            f'<wp:extent cx="1371600" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="{index}" name="{preset} {index}"/><wp:cNvGraphicFramePr/>'
            f'<a:graphic><a:graphicData uri="{WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1371600" cy="914400"/></a:xfrm>'
            f'<a:prstGeom prst="{preset}"><a:avLst>{gd}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:ln></wps:spPr>'
            f'<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>')

runs = ''.join(shape(i + 1, preset, adj, 914400 + (i % 4) * 1600200, 1371600 + (i // 4) * 1280160) for i, (preset, adj) in enumerate(PRESETS))
body = f'<w:p><w:r><w:t>Preset geometry control</w:t></w:r>{runs}</w:p>'
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts = dict(shell)
parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:wps="{WPS}"><w:body>{body}</w:body></w:document>'

if __name__ == '__main__':
    out = Path(__file__).resolve().parents[1] / 'public/fixtures/preset-geometries.docx'
    with ZipFile(out, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)
    print(out)
