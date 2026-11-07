"""Original translucent SVG group controls; no corpus artwork or markup."""
import canvas_svg_fixture as fixture

fixture.SOURCE = fixture.SOURCE.with_name('svg-group-raster.docx')
rows = []
# Thin overlapping fills expose pixel-grid sampling and group compositing.
for index, attributes in enumerate(['', 'opacity="0.8"', 'opacity="0.5"', 'opacity="0.8" transform="translate(.35 .2)"']):
    paths = '<path d="M10.2 0.2L105.7 0.8L105.1 1.5L10.5 1.1Z" fill="#4080C0"/>'
    paths += '<path d="M10.4 .6L105.2 1L104.5 1.9L10.7 1.6Z" fill="#D08040" opacity="0.8"/>'
    rows.append(f'<g transform="translate(0 {8+index*18})"><g {attributes}>{paths}</g></g>')
rows.append('<g opacity="0.8"><g opacity="0.8"><path d="M10.2 81.3L105.7 81.8L104.9 82.6L10.6 82.2Z" fill="#4080C0"/></g></g>')
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">'+''.join(rows)+'</svg>').encode()
fixture.generate()
