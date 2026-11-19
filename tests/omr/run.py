"""Run the authored test set against the SDK pinned in this checkout."""

import argparse
from base64 import b64encode
from importlib.metadata import version
import json
from pathlib import Path
import platform
import subprocess
import tempfile
from xml.etree import ElementTree as ET

from browser import REPO, launch, read_crops, recognize, serve_sdk
from suite import FIXTURES, compare_baseline, compare_marks, compare_score, digest, load_manifest

CORPORA = {'regression': FIXTURES, 'woodwind': FIXTURES.with_name('omr-woodwind')}


def save(path, data):
    pending = path.with_suffix('.tmp')
    pending.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str) + '\n', encoding='utf-8')
    pending.replace(path)


def load_baseline(path, cases, manifest_hash):
    baseline = json.loads(path.read_bytes())
    if baseline.get('version') != 1 or baseline.get('manifestSha256') != manifest_hash:
        raise ValueError('Baseline does not match the frozen test set manifest')
    if set(baseline['cases']) != set(cases):
        raise ValueError('Baseline must cover every manifest case')
    for case_id, row in baseline['cases'].items():
        discrepancies = row['discrepancies']
        if cases[case_id]['kind'] == 'tuplet-crop' and discrepancies:
            raise ValueError(f'{case_id}: crop controls require exact matches')
        compare_baseline(discrepancies, discrepancies)
    return baseline


def check_frozen_cases(before, before_baseline, after, after_baseline):
    if before['evaluators'] != after['evaluators']:
        raise ValueError('The v1 scoring reference is frozen')
    cases = {case['id']: case for case in after['cases']}
    for case in before['cases']:
        identifier = case['id']
        if cases.get(identifier) != case:
            raise ValueError(f'{identifier}: existing v1 case or reference changed')
        previous = before_baseline['cases'][identifier]['discrepancies']
        proposed = after_baseline['cases'][identifier]['discrepancies']
        if compare_baseline(proposed, previous)['new']:
            raise ValueError(f'{identifier}: proposed baseline introduces new allowed discrepancies')


def check_pr_base(ref, baseline, fixtures=FIXTURES):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=REPO)

    commit = git('rev-parse', '--verify', '--end-of-options', f'{ref}^{{commit}}').decode().strip()
    prefix = fixtures.relative_to(REPO).as_posix()
    if not git('ls-tree', commit, '--', f'{prefix}/baseline.json'):
        return  # First version of the suite in this repository.
    previous_manifest = git('show', f'{commit}:{prefix}/manifest.json')
    previous_baseline = json.loads(git('show', f'{commit}:{prefix}/baseline.json'))
    if digest(previous_manifest) != previous_baseline['manifestSha256']:
        raise ValueError('PR base has an inconsistent OMR manifest and baseline')
    check_frozen_cases(json.loads(previous_manifest), previous_baseline,
                       json.loads((fixtures / 'manifest.json').read_bytes()), baseline)


def record_case(report, output, case, observed, discrepancies, baseline):
    gate = compare_baseline(discrepancies, baseline['discrepancies'])
    row = {**case, **observed, 'gate': gate, 'status': 'regression' if gate['new'] else 'pass'}
    report['cases'][case['id']] = row
    save(output / 'report.json', report)
    print(f'{case["id"]}: {row["status"]}, {len(gate["new"])} new and '
          f'{len(gate["resolved"])} resolved discrepancies', flush=True)


def failed_case(report, output, case, error):
    row = {**case, 'status': 'failed', 'error': str(error)}
    report['cases'][case['id']] = row
    save(output / 'report.json', report)
    print(f'{case["id"]}: {error}', flush=True)


def run(cases, report, baseline, output, sdk_root, pin, executable, shared, fixtures):
    from playwright.sync_api import sync_playwright

    with serve_sdk(sdk_root) as origin, sync_playwright() as playwright:
        chromium = launch(playwright, executable)
        report['browser'] = chromium.version
        try:
            crop_cases = [case for case in cases.values() if case['kind'] == 'tuplet-crop']
            if crop_cases:
                inputs = [dict(id=case['id'], staffBoxes=case['staffBoxes'],
                               png=b64encode((fixtures / case['source']['file']).read_bytes()).decode())
                          for case in crop_cases]
                try:
                    marks, modules = read_crops(chromium, origin, sdk_root, pin, inputs)
                    readings = {item['id']: item['marks'] for item in marks}
                    if len(marks) != len(crop_cases) or set(readings) != {case['id'] for case in crop_cases}:
                        raise ValueError('Crop probe did not report each input exactly once')
                    report['cropModules'] = modules
                except Exception as error:
                    for case in crop_cases:
                        failed_case(report, output, case, error)
                else:
                    for case in crop_cases:
                        observed = readings[case['id']]
                        try:
                            discrepancies = compare_marks(case['marks'], observed)
                            record_case(report, output, case, dict(observedMarks=observed, discrepancies=discrepancies),
                                        discrepancies, baseline['cases'][case['id']])
                        except Exception as error:
                            failed_case(report, output, case, error)

            for case in cases.values():
                if case['kind'] != 'pdf':
                    continue
                identifier = case['id']
                dest = output / identifier
                dest.mkdir()
                print(f'Recognizing {identifier}', flush=True)
                try:
                    stages, receipt = recognize(chromium, origin, pin, fixtures / case['source']['file'], dest, shared)
                    truth = ET.parse(fixtures / case['truth']['file']).getroot()
                    comparisons = {name: compare_score(truth, ET.fromstring(xml)) for name, xml in stages.items()}
                    discrepancies = comparisons['final']['discrepancies']
                    data = dict(browserRun=receipt, comparisons=comparisons)
                    record_case(report, output, case, data, discrepancies, baseline['cases'][identifier])
                except Exception as error:
                    failed_case(report, output, case, error)
        finally:
            chromium.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', help='Use this executable instead of Playwright Chromium')
    parser.add_argument('--output', type=Path, help='Write results to this new directory')
    parser.add_argument('--shared', action='store_true', help='Use the SDK shared-memory bridge')
    parser.add_argument('--base-ref', help='Check existing references and allowances against this Git revision')
    parser.add_argument('--corpus', choices=CORPORA, default='regression', help='Choose the frozen score set')
    args = parser.parse_args()
    fixtures = CORPORA[args.corpus]
    cases, manifest_hash = load_manifest(fixtures)
    baseline_path = fixtures / 'baseline.json'
    baseline = load_baseline(baseline_path, cases, manifest_hash)
    if args.base_ref:
        check_pr_base(args.base_ref, baseline, fixtures)
    pin_path = REPO / 'vendor' / 'sheetscan' / 'pin.json'
    pin = json.loads(pin_path.read_bytes())
    sdk_root = REPO / 'public' / 'vendor' / 'sheetscan'
    if json.loads((sdk_root / pin['version'] / 'pin.json').read_bytes()) != pin:
        raise ValueError('Prepared SDK does not match the current pin. Run npm run test:omr.')
    if args.output:
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=False)
    else:
        root = REPO / 'test-results' / 'omr'
        root.mkdir(parents=True, exist_ok=True)
        output = Path(tempfile.mkdtemp(prefix='run-', dir=root))
    print(f'OMR report: {output / "report.json"}', flush=True)
    report = dict(version=1, corpus=args.corpus, manifestSha256=manifest_hash, baselineSha256=digest(baseline_path.read_bytes()),
                  pinSha256=digest(pin_path.read_bytes()), sdkVersion=pin['version'],
                  sourceCommit=pin['sourceCommit'], models={model['name']: model['sha256'] for model in pin['models']},
                  runtimeLockSha256=pin['files']['runtime-lock.json'], bridge='shared memory' if args.shared else 'jspi',
                  python=platform.python_version(), platform=platform.platform(), playwright=version('playwright'),
                  status='running', cases={})
    save(output / 'report.json', report)
    try:
        run(cases, report, baseline, output, sdk_root, pin, args.chromium, args.shared, fixtures)
    except Exception as error:
        report['error'] = str(error)
        report['status'] = 'failed'
        save(output / 'report.json', report)
        raise
    passed = set(report['cases']) == set(cases) and all(row['status'] == 'pass' for row in report['cases'].values())
    report['status'] = 'pass' if passed else 'failed'
    pdfs = [case for case in cases.values() if case['kind'] == 'pdf']
    scored = [row['comparisons']['final']['core'] for row in report['cases'].values() if 'comparisons' in row]
    report['totals'] = {
        'pdfScores': len(pdfs),
        'scoredPdfScores': len(scored),
        'strictEvents': dict(
            correct=sum(row['events']['correct'] for row in scored),
            truth=sum(case['inventory']['events'] for case in pdfs),
            reading=sum(row['events']['reading'] for row in scored),
        ),
    }
    save(output / 'report.json', report)
    print(f'OMR test set {report["status"]}: {len(report["cases"])}/{len(cases)} cases reported', flush=True)
    return int(not passed)


if __name__ == '__main__':
    raise SystemExit(main())
