"""Independent solid SVG group geometry, viewport and scale controls."""
import canvas_svg_fixture as fixture

fixture.SOURCE = fixture.SOURCE.with_name('svg-group-transforms.docx')
fixture.SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 240 200">
<g opacity="0.8" transform="translate(2.3 4.2) scale(1.5 .75)"><rect x="12.2" y="4.4" width="100.5" height="12.6" rx="3" ry="2" fill="#4080C0"/></g>
<g opacity="0.5" transform="translate(0 40) scale(1.2 .75)"><ellipse cx="90.3" cy="12.5" rx="60.2" ry="7.3" fill="#D08040"/></g>
<g opacity="0.8" transform="translate(2.5 90)"><g opacity="0.8" transform="scale(.8 1.3)"><polygon points="12.2,2.4 202.5,6.7 190.3,12.2 10.5,8.1" fill="#4080C0"/></g></g>
<g opacity="0.6" transform="translate(0 140)"><path fill-rule="evenodd" d="M10.2 0.3H205.4V24.7H10.2Z M20.3 5.1H195.6V19.2H20.3Z" fill="#D08040"/></g>
</svg>'''
fixture.generate()
