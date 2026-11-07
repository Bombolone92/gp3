"""Independent SVG fractional-stroke probes with a visibly different fallback."""
import canvas_svg_fixture as fixture

widths = ['0.125', '0.25', '0.5', '0.75', '1', '1.5', '2', '4']
shapes = ''.join(
    f'<rect x="{8 + (i % 4) * 28}" y="{10 + (i // 4) * 36}" width="16" height="16" fill="#E8EDD6" stroke="#000000" stroke-width="{width}"/>'
    for i, width in enumerate(widths)
)
if __name__ == '__main__':
    primitive_shapes = ''
    for row, tag in enumerate(['rect', 'line', 'path', 'circle']):
        for col, width in enumerate(['0.25', '0.5', '1', '2']):
            x, y = 8 + col * 28, 6 + row * 19
            geometry = {'rect': f'x="{x}" y="{y}" width="12" height="12"',
                        'line': f'x1="{x}" y1="{y}" x2="{x+12}" y2="{y}"',
                        'path': f'd="M{x} {y}h12v12h-12Z"',
                        'circle': f'cx="{x+6}" cy="{y+6}" r="6"'}[tag]
            primitive_shapes += f'<{tag} {geometry} fill="none" stroke="black" stroke-width="{width}"/>'
    cases = [
        ('svg-strokes', ' width="120" height="80"', '0 0 120 80', shapes),
        ('svg-strokes-viewbox', '', '0 0 120 80', shapes),
        ('svg-strokes-double-size', ' width="240" height="160"', '0 0 120 80', shapes),
        ('svg-strokes-scaled', ' width="120" height="80"', '0 0 240 160', f'<g transform="scale(2)">{shapes}</g>'),
        ('svg-strokes-group', ' width="240" height="160"', '0 0 240 160', f'<g transform="scale(2)">{shapes}</g>'),
        ('svg-strokes-primitives', ' width="120" height="80"', '0 0 120 80', primitive_shapes),
    ]
    for name, dimensions, viewbox, content in cases:
        fixture.SOURCE = fixture.SOURCE.with_name(name + '.docx')
        fixture.SVG = f'<svg xmlns="http://www.w3.org/2000/svg"{dimensions} viewBox="{viewbox}">{content}</svg>'.encode()
        fixture.generate()
