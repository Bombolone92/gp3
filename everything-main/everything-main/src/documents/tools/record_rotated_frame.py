"""Record original frame probes, preserving the native rectangle geometry."""
import json
import struct
from rotated_frame_fixture import build, FOLDER
from record_rotated_spacing_phase import record, validate_wrapper


def highlights(data):
    # MS-EMF 2.3.7.1 and 2.3.1.2: selected solid brush, PATCOPY destination.
    # Deliberately bounded to these original captures, not an EMF renderer.
    validate_wrapper(data)
    offset, selected, brushes, stack, rectangles = 0, None, {}, [], []
    while offset < len(data):
        kind, size = struct.unpack_from('<II', data, offset)
        if kind == 39:
            handle, style, color, hatch = struct.unpack_from('<4I', data, offset + 8)
            brushes[handle] = (style, color, hatch)
        elif kind == 37:
            handle = struct.unpack_from('<I', data, offset + 8)[0]
            if handle in brushes:
                selected = brushes[handle]
            elif handle in [0x80000000 + i for i in (0, 1, 2, 3, 4, 5, 18)]:
                selected = None
        elif kind == 40:
            brushes.pop(struct.unpack_from('<I', data, offset + 8)[0], None)
        elif kind == 33:
            stack.append(selected)
        elif kind == 34:
            level = struct.unpack_from('<i', data, offset + 8)[0]
            if level >= 0 or -level > len(stack):
                raise ValueError('Unresolved DC restore')
            selected, stack = stack[level], stack[:level]
        elif kind == 76 and selected == (0, 0x0200ffff, 0):
            if size != 100 or struct.unpack_from('<I', data, offset + 40)[0] != 0x00f00021:
                raise ValueError('Expected solid PATCOPY highlight')
            x, y, width, height = struct.unpack_from('<4i', data, offset + 24)
            if min(width, height) <= 0:
                raise ValueError('Unexpected highlight rectangle')
            rectangles.append(dict(x=x, y=y, width=width, height=height))
        offset += size
    if len(rectangles) != 12:
        raise ValueError('Expected twelve highlighted text lines')
    return rectangles


def references():
    result = {}
    base = record()
    for variant in ('highlight', 'margin', 'multiple'):
        folder = FOLDER / variant
        ref = record(folder, lambda: build(variant))
        if variant != 'multiple' and [c['rows'] for c in ref['cases']] != [c['rows'] for c in base['cases']]:
            raise ValueError(f'{variant} changes native local baselines')
        if variant == 'highlight':
            for i, case in enumerate(ref['cases'], 1):
                case['highlightRectangles'] = highlights((folder / f'native-table-{i}.emf').read_bytes())
        result[variant] = ref
    return result


if __name__ == '__main__':
    for variant, ref in references().items():
        (FOLDER / variant / 'native-reference.json').write_text(json.dumps(ref, indent=2) + '\n')
    print('Recorded 1,296 native baselines and 432 highlight rectangles')
