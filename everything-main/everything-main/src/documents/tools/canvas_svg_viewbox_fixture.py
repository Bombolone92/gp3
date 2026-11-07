"""Independent ratio-only SVG picture fixture, using the original SVG generator."""
import canvas_svg_fixture as fixture

fixture.SOURCE = fixture.SOURCE.with_name('svg-viewbox-pictures.docx')
fixture.SVG = fixture.SVG.replace(b' width="120" height="80"', b'', 1)
if __name__ == '__main__': fixture.generate()
