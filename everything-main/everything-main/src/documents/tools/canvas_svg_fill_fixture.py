"""Original solid/translucent SVG viewport probe, with no corpus artwork."""
import canvas_svg_fixture as fixture

def composition():
    fixture.SOURCE = fixture.SOURCE.with_name('svg-opacity-composition.docx')
    shapes = '<rect width="120" height="100" fill="white"/>'
    for row, (a, b) in enumerate([(.9, .9), (.1, .9), (.5, .5), (.3, .9)]):
        y = row * 20
        shapes += f'<rect y="{y}" width="30" height="20" fill="#4080C0" opacity="{a}" fill-opacity="{b}"/>'
        shapes += f'<g opacity="{a}"><rect x="30" y="{y}" width="30" height="20" fill="#4080C0" opacity="{b}"/></g>'
        shapes += f'<g opacity="{a}"><rect x="60" y="{y}" width="30" height="20" fill="#4080C0" fill-opacity="{b}"/></g>'
        shapes += f'<rect x="90" y="{y}" width="30" height="20" fill="#4080C0" opacity="{a*b}"/>'
    shapes += '<rect x="4" y="84" width="22" height="12" fill="#4080C0" stroke="#D08040" stroke-width="4" opacity="0.5"/>'
    shapes += '<rect x="34" y="84" width="22" height="12" fill="#4080C0" stroke="#D08040" stroke-width="4" opacity="0.9" fill-opacity="0.9" stroke-opacity="0.3"/>'
    shapes += '<rect x="64" y="84" width="22" height="12" fill="rgba(64,128,192,0.9)" opacity="0.9"/>'
    shapes += '<g fill-opacity="0.5"><rect x="94" y="84" width="22" height="12" fill="#4080C0"/></g>'
    fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">'+shapes+'</svg>').encode()
    fixture.generate()

if __name__ == '__main__':
    fixture.SOURCE = fixture.SOURCE.with_name('svg-fill-viewport.docx')
    fixture.SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
<rect width="120" height="80" fill="#F2F2F2"/>
<rect width="60" height="40" fill="#4080C0" opacity="0.1"/>
<rect x="60" width="60" height="40" fill="#4080C0" opacity="0.3"/>
<path d="M0 80V40L60 80Z" fill="#D08040"/>
<rect x="80" y="50" width="20" height="20" fill="#4080C0"/>
</svg>'''
    fixture.generate()
    fixture.SOURCE = fixture.SOURCE.with_name('svg-opacity-values.docx')
    values = ['0', '0.001', '0.1', '0.3', '0.5', '0.75', '0.999', '1']
    shapes = []
    for row, declaration in enumerate(['opacity="{v}"', 'style="opacity:{v}"', 'fill-opacity="{v}"']):
        for col, value in enumerate(values):
            shapes.append(f'<rect x="{col*15}" y="{row*20}" width="15" height="20" fill="#4080C0" {declaration.format(v=value)}/>')
    shapes.append('<g opacity="0.5"><rect y="60" width="30" height="20" fill="#4080C0"/></g>')
    shapes.append('<rect x="30" y="60" width="30" height="20" fill="#4080C0" opacity="0.5" fill-opacity="0.5"/>')
    shapes.append('<style>.faded {opacity:0.5}</style><rect class="faded" x="60" y="60" width="30" height="20" fill="#4080C0"/>')
    shapes.append('<g opacity="0.5"><rect x="90" y="60" width="30" height="20" fill="#4080C0" opacity="0.5"/></g>')
    fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">' + ''.join(shapes) + '</svg>').encode()
    fixture.generate()
    composition()
