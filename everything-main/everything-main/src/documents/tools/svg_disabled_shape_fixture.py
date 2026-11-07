"""Authored SVG group controls for geometry that disables rendering (SVG 1.1)."""
import canvas_svg_fixture as fixture

fixture.SOURCE = fixture.SOURCE.with_name('svg-disabled-shapes.docx')
visible = ('<path d="M10.2 .2L105.7 .8L105.1 1.5L10.5 1.1Z" fill="#4080C0"/>'
           '<path d="M10.4 .6L105.2 1L104.5 1.9L10.7 1.6Z" fill="#D08040" opacity=".8"/>')
disabled = ['', '<rect width="0" height="4" fill="url(#paint)" stroke="red"/>',
            '<circle r="0" fill="url(#paint)" stroke="red"/>',
            '<ellipse rx="4" ry="0" fill="url(#paint)" stroke="red"/>']
fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">'
               '<defs><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>'
               + ''.join(f'<g opacity=".8" transform="translate(0 {8+i*18})">{visible}{extra}</g>'
                         for i,extra in enumerate(disabled)) + '</svg>').encode()
if __name__ == '__main__':
    if fixture.SOURCE.exists():
        raise SystemExit('Refusing to replace an existing captured fixture.')
    fixture.generate()
