"""Synthetic PDFs only. Run separately from Node: python -m unittest discover -s test -p pdf_reader_test.py"""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter

spec = importlib.util.spec_from_file_location('pdf_reader', Path(__file__).resolve().parents[1]/'src/pdf/read.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReaderTest(unittest.TestCase):
    def setUp(self):
        base = Path(__file__).resolve().parents[1]/'out'/'test-pdf-tmp'
        base.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='pdf-reader-test-', dir=base)
        self.root = Path(self.temporary.name)
        self.source = self.root/'fixture.pdf'
        c = canvas.Canvas(str(self.source), pagesize=(200, 200))
        c.setTitle('Synthetic fixture')
        c.drawString(20, 170, 'Fixture claim 28.4')
        c.setFillColorRGB(1, 0, 0)
        c.rect(20, 100, 60, 40, stroke=0, fill=1)
        c.showPage()
        c.circle(80, 80, 20)
        c.showPage()
        c.save()
        self.hash = module.digest(self.source.read_bytes())

    def tearDown(self):
        self.temporary.cleanup()

    def plan(self):
        return {'version': 1, 'sourceSha256': self.hash, 'regions': [{'id': 'red-box', 'page': 1, 'box': [20, 60, 80, 100], 'label': 'Synthetic red rectangle', 'kind': 'figure'}]}

    def test_text_coordinates_labels_hash_and_empty_page(self):
        result = module.read_pdf(self.source, self.root/'read')
        self.assertEqual(result['summary']['pages'], 2)
        self.assertEqual(result['source']['sha256'], self.hash)
        self.assertEqual(module.digest(self.source.read_bytes()), self.hash)
        page = result['pages'][0]
        self.assertEqual(page['pageLabel'], '1')
        self.assertIn('28.4', page['text'])
        word = next(w for w in page['words'] if w['text'] == 'Fixture')
        self.assertAlmostEqual(word['box'][0], 20)
        self.assertLess(word['box'][1], 35)
        self.assertEqual(result['pages'][1]['textStatus'], 'needs-review-or-ocr')
        self.assertEqual(result['issues'][0]['page'], 2)

    def test_planned_render_uses_top_left_pdf_points_and_preserves_source(self):
        result = module.read_pdf(self.source, self.root/'read', self.plan())
        asset = result['assets'][0]
        self.assertEqual((asset['pixelWidth'], asset['pixelHeight']), (120, 80))
        with Image.open(self.root/'read'/asset['path']) as image:
            self.assertEqual(image.convert('RGB').getpixel((60, 40)), (255, 0, 0))
        self.assertEqual(module.digest(self.source.read_bytes()), self.hash)
        self.assertEqual(module.digest((self.root/'read'/asset['path']).read_bytes()), asset['sha256'])

    def test_stale_plan_bad_boxes_duplicate_ids_and_unsafe_paths_are_refused(self):
        mutations = [
            lambda p: p.update(sourceSha256='0'*64),
            lambda p: p['regions'][0].update(id='../escape'),
            lambda p: p['regions'][0].update(page=99),
            lambda p: p['regions'][0].update(box=[0, 0, 999, 20]),
            lambda p: p['regions'][0].update(box=[1, 1, 1, 2]),
            lambda p: p['regions'].append(copy.deepcopy(p['regions'][0])),
            lambda p: p.update(version=True),
            lambda p: p['regions'][0].update(box=[0, 0, float('nan'), 20])
        ]
        for mutate in mutations:
            plan = self.plan()
            mutate(plan)
            with self.assertRaises(ValueError):
                module.read_pdf(self.source, self.root/'read', plan)
            self.assertFalse((self.root/'read').exists())

    def test_output_never_overwrites_an_existing_directory(self):
        output = self.root/'existing'
        output.mkdir()
        (output/'keep.txt').write_text('keep', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'OUTPUT_EXISTS'):
            module.read_pdf(self.source, output)
        self.assertEqual((output/'keep.txt').read_text(), 'keep')

    def test_render_failure_cleans_only_its_own_temporary_output(self):
        (self.root/'keep.txt').write_text('keep')
        with patch.object(module.pdfium.PdfPage, 'render', side_effect=RuntimeError('synthetic render failure')):
            with self.assertRaisesRegex(RuntimeError, 'synthetic render failure'):
                module.read_pdf(self.source, self.root/'read', self.plan())
        self.assertFalse((self.root/'read').exists())
        self.assertEqual(list(self.root.glob('.pdf-read-*')), [])
        self.assertEqual((self.root/'keep.txt').read_text(), 'keep')

    def test_encrypted_pdf_and_non_pdf_input_and_invalid_dpi_are_refused(self):
        writer = PdfWriter()
        writer.append(PdfReader(self.source))
        writer.encrypt('test-only-password')
        encrypted = self.root/'encrypted.pdf'
        with encrypted.open('wb') as stream:
            writer.write(stream)
        with self.assertRaisesRegex(ValueError, 'ENCRYPTED_PDF'):
            module.read_pdf(encrypted, self.root/'read')
        fake = self.root/'fake.pdf'
        fake.write_bytes(b'not a PDF')
        with self.assertRaisesRegex(ValueError, 'NOT_A_PDF'):
            module.read_pdf(fake, self.root/'read')
        with self.assertRaisesRegex(ValueError, 'DPI_LIMIT'):
            module.read_pdf(self.source, self.root/'read', dpi=500)


if __name__ == '__main__':
    unittest.main()
