"""Independent SVG XML whitespace fixture, using the original SVG generator."""
import canvas_svg_fixture as fixture

fixture.SOURCE = fixture.SOURCE.with_name('svg-space-pictures.docx')
fixture.SVG = fixture.SVG.replace(b'<svg ', b'<svg xml:space="preserve" ', 1)
if __name__ == '__main__': fixture.generate()
