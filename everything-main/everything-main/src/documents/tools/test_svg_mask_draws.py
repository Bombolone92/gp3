"""Retained controls and binary holdouts for the draw-time evidence reader."""
import struct
import unittest
from inspect_svg_mask_draws import ROOT, FIXTURES, inspect, audit


def record(tag, flags, payload=b''):
    padding = b'\0' * (-len(payload) % 4)
    return struct.pack('<HHII', tag, flags, 12 + len(payload) + len(padding), len(payload)) + payload + padding


def stream(records):
    comment = b'EMF+' + b''.join(records)
    body = struct.pack('<III', 70, 12 + len(comment), len(comment)) + comment
    header = bytearray(108)
    struct.pack_into('<II', header, 0, 1, len(header))
    header[40:44] = b' EMF'
    struct.pack_into('<II', header, 48, len(header) + len(body) + 8, 3)
    return bytes(header) + body + struct.pack('<II', 14, 8)


def image():
    png = (ROOT / 'tests/fixtures/svg-mask-edges/native-mask-1.png').read_bytes()
    return record(0x4008, 0x0500, struct.pack('<7I', 0xdbc01002, 1, 0, 0, 0, 0, 1) + png)


def draw(flags=0x4000):
    return record(0x401b, flags, struct.pack('<II4fI6h', 0xffffffff, 2, -.5, -.5, 15, 62, 3, 0, 0, 15, 0, 0, 62))


class DrawEvidenceTests(unittest.TestCase):
    def test_draw_uses_current_transform_not_object_creation(self):
        a = [1, 0, 0, 1, 10, 20]; b = [1, 0, 0, 1, 30, 40]
        images, draws = inspect(stream([record(0x402a, 0, struct.pack('<6f', *a)), image(),
                                        record(0x402a, 0, struct.pack('<6f', *b)), draw()]))
        self.assertEqual(images[0]['creationTransform'], a)
        self.assertEqual(draws[0]['worldTransform'], b)
        self.assertEqual(draws[0]['sourceRect'], [-.5, -.5, 15, 62])

    def test_reused_slot_binds_current_generation(self):
        images, draws = inspect(stream([image(), draw(), image(), draw()]))
        self.assertEqual([d['index'] for d in draws], [0, 1])
        self.assertEqual([d['objectId'] for d in draws], [0, 0])

    def test_antialias_flag_and_mode_are_distinct_and_follow_draw_state(self):
        _, draws = inspect(stream([image(), record(0x401e, 9), draw(),
                                   record(0x401e, 6), draw()]))
        self.assertEqual(draws[0]['antiAliasMode'], {'enabled': True, 'mode': 4})
        self.assertEqual(draws[1]['antiAliasMode'], {'enabled': False, 'mode': 3})

    def test_replaced_image_and_relative_points_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'missing image'):
            inspect(stream([image(), record(0x4008, 0x0100), draw()]))
        with self.assertRaisesRegex(ValueError, 'Relative points'):
            inspect(stream([image(), draw(0x4800)]))

    def test_unsupported_state_and_truncation_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported state'):
            inspect(stream([image(), record(0x402b, 0), draw()]))
        with self.assertRaisesRegex(ValueError, 'byte count'):
            inspect(stream([image(), draw()])[:-1])

    def test_all_retained_controls_bind_draw_state_without_replacing_goldens(self):
        rows = [audit(name) for name in FIXTURES]
        draws = [d for row in rows for d in row['draws']]
        self.assertEqual(len(draws), 132)
        for d in draws:
            self.assertEqual(d['worldTransform'], d['legacyReferenceTransform'])
            self.assertEqual(d['sourceRect'], [-.5, -.5, *d['size']])
            self.assertEqual(d['points'], [[0, 0], [d['size'][0], 0], [0, d['size'][1]]])
            self.assertEqual(d['pageTransform'], {'unit': 2, 'scale': 1})
            self.assertEqual(d['interpolationMode'], 7)
            self.assertEqual(d['pixelOffsetMode'], 4)
            self.assertEqual(d['antiAliasMode'], {'enabled': True, 'mode': 4})
            self.assertIsNone(d['imageAttributes'])


if __name__ == '__main__':
    unittest.main()
