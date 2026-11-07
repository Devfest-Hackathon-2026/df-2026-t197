"""Read-only PDF indexing and explicitly planned region rendering; no AI or OCR."""
import argparse
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile

import pdfplumber
import pypdfium2 as pdfium
from pypdf import PdfReader


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_plan(plan, source_hash, pages):
    if not isinstance(plan, dict) or set(plan) != {'version', 'sourceSha256', 'regions'} or type(plan['version']) is not int or plan['version'] != 1:
        raise ValueError('INVALID_PDF_PLAN')
    if plan['sourceSha256'] != source_hash:
        raise ValueError('STALE_INPUT')
    regions = plan['regions']
    if not isinstance(regions, list) or len(regions) > 50:
        raise ValueError('REGION_COUNT_LIMIT')
    seen = set()
    for region in regions:
        if not isinstance(region, dict) or set(region) != {'id', 'page', 'box', 'label', 'kind'}:
            raise ValueError('INVALID_PDF_REGION')
        if not isinstance(region['id'], str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', region['id']) or region['id'] in seen:
            raise ValueError('INVALID_OR_DUPLICATE_REGION_ID')
        seen.add(region['id'])
        if type(region['page']) is not int or not 1 <= region['page'] <= len(pages):
            raise ValueError('REGION_PAGE_OUT_OF_RANGE')
        if region['kind'] not in ('figure', 'table', 'page', 'other') or not isinstance(region['label'], str) or not 1 <= len(region['label']) <= 500:
            raise ValueError('INVALID_REGION_DESCRIPTION')
        box = region['box']
        if not isinstance(box, list) or len(box) != 4 or any(type(v) not in (float, int) or not math.isfinite(v) for v in box):
            raise ValueError('INVALID_REGION_BOX')
        page = pages[region['page'] - 1]
        if not (0 <= box[0] < box[2] <= page['widthPt'] and 0 <= box[1] < box[3] <= page['heightPt']):
            raise ValueError('REGION_BOX_OUT_OF_RANGE')
    return regions


def read_pdf(source, output, plan=None, dpi=144):
    source, output = Path(source).resolve(), Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('OUTPUT_EXISTS')
    if not source.is_file() or source.stat().st_size > 64 * 1024**2:
        raise ValueError('INPUT_SIZE_LIMIT_OR_NOT_FILE')
    if type(dpi) is not int or not 72 <= dpi <= 300:
        raise ValueError('DPI_LIMIT')
    data = source.read_bytes()
    if not data.startswith(b'%PDF-'):
        raise ValueError('NOT_A_PDF')
    source_hash = digest(data)
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError('ENCRYPTED_PDF_NOT_SUPPORTED')
    if not 1 <= len(reader.pages) <= 300:
        raise ValueError('PAGE_COUNT_LIMIT')
    labels = reader.page_labels
    pages, issues, total_chars = [], [], 0
    with pdfplumber.open(io.BytesIO(data)) as document:
        for number, page in enumerate(document.pages, 1):
            text = page.extract_text() or ''
            words = page.extract_words()
            total_chars += len(text)
            if len(words) > 100000 or total_chars > 8000000:
                raise ValueError('PDF_TEXT_SIZE_LIMIT')
            if not text.strip():
                issues.append({'code': 'NO_EXTRACTABLE_TEXT', 'page': number, 'detail': 'OCR not run; this is not proof of an empty page'})
            pages.append({'page': number, 'pageLabel': labels[number-1], 'widthPt': float(page.width), 'heightPt': float(page.height), 'rotation': page.rotation,
                          'bbox': list(page.bbox), 'text': text, 'textSha256': digest(text.encode('utf-8')),
                          'words': [{'text': w['text'], 'box': [w['x0'], w['top'], w['x1'], w['bottom']]} for w in words],
                          'imageObjectCount': len(page.images), 'textStatus': 'extracted' if text.strip() else 'needs-review-or-ocr'})
            page.close()
    regions = validate_plan(plan, source_hash, pages) if plan is not None else []
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.pdf-read-', dir=output.parent))
    try:
        assets = []
        with pdfium.PdfDocument(data) as document:
            for region in regions:
                page = document[region['page']-1]
                bitmap = None
                try:
                    width, height = page.get_size()
                    recorded = pages[region['page']-1]
                    if abs(width-recorded['widthPt']) > .01 or abs(height-recorded['heightPt']) > .01 or any(abs(v) > .01 for v in recorded['bbox'][:2]):
                        raise ValueError('REGION_COORDINATE_SYSTEM_NOT_SUPPORTED')
                    x0, top, x1, bottom = region['box']
                    if math.ceil((x1-x0)*dpi/72)*math.ceil((bottom-top)*dpi/72) > 20000000:
                        raise ValueError('RENDER_PIXEL_LIMIT')
                    bitmap = page.render(scale=dpi/72, crop=(x0, height-bottom, width-x1, top), may_draw_forms=False)
                    image = bitmap.to_pil()
                    filename = region['id']+'.png'
                    image.save(stage/filename)
                    assets.append({**region, 'path': filename, 'sha256': digest((stage/filename).read_bytes()), 'pixelWidth': image.width, 'pixelHeight': image.height, 'dpi': dpi, 'coordinateSystem': 'PDF points from top-left of displayed page', 'recognition': 'user/agent-specified region; no automatic figure/table recognition'})
                    image.close()
                finally:
                    if bitmap is not None:
                        bitmap.close()
                    page.close()
        metadata = reader.metadata or {}
        result = {'version': 1, 'readOnly': True, 'source': {'sha256': source_hash, 'bytes': len(data), 'title': str(metadata.get('/Title', ''))},
                  'summary': {'pages': len(pages), 'characters': total_chars, 'assets': len(assets)}, 'pages': pages, 'assets': assets, 'issues': issues,
                  'runtime': {name: importlib.metadata.version(name) for name in ('pypdf', 'pdfplumber', 'pypdfium2', 'Pillow')},
                  'limitations': ['No OCR, math decoding, automatic section/figure/table recognition, table cell reconstruction or factual verification.', 'Text order and equations must be checked visually; extraction is not semantic understanding.', 'Rendered regions are raster images, not editable diagrams/tables.', 'Page numbers are physical 1-based PDF pages; pageLabel is retained separately.', 'Unsupported render/text coordinate mismatches are rejected; arbitrary cropboxes/UserUnit/rotated documents are not guaranteed.']}
        (stage/'index.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        if digest(source.read_bytes()) != source_hash:
            raise ValueError('SOURCE_CHANGED_DURING_READ')
        if output.exists() or output.is_symlink():
            raise ValueError('OUTPUT_EXISTS')
        stage.rename(output)
        return result
    finally:
        if stage.exists():
            if stage.parent.resolve() != output.parent.resolve() or not stage.name.startswith('.pdf-read-') or stage.is_symlink():
                raise RuntimeError('TEMPORARY_PATH_CHECK_FAILED')
            shutil.rmtree(stage)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--plan')
    parser.add_argument('--dpi', type=int, default=144)
    args = parser.parse_args()
    try:
        plan = json.loads(Path(args.plan).read_text(encoding='utf-8-sig')) if args.plan else None
        result = read_pdf(args.source, args.output, plan, args.dpi)
        print(json.dumps({'output': str(Path(args.output).absolute()), 'summary': result['summary'], 'issues': len(result['issues'])}))
    except Exception as error:
        parser.exit(1, f'{type(error).__name__}: {error}\n')
