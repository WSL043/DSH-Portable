"""Verify distribution identity without executing any downloaded program."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import zipfile

directory = Path('release-input')
load = lambda name: json.loads((directory / name).read_text(encoding='utf-8-sig'))
qualification = load('qualification.json')
run = json.loads(Path('qualification-run.json').read_text(encoding='utf-8-sig'))
version = qualification['version']
assert re.fullmatch(r'1\.0\.0-alpha\.[1-9][0-9]*', version), 'Only alpha previews may use this publisher'
assert qualification['sourceCommit'] == run['headSha'], 'Source identity mismatch'
expected_run = f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['RUN_ID']}"
assert qualification['nativeQualification'] == expected_run, 'Wrong qualification run'
assert load('qualified-candidate.json')['evidence'] == expected_run, 'Wrong candidate evidence'
archive = directory / f'DSH-Portable-{version}-windows-x64.zip'
checksum, filename = (directory / 'checksums.txt').read_text().strip().split()
assert filename == archive.name, 'Wrong archive filename'
with archive.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == checksum, 'Archive digest mismatch'
root = f'DSH-Portable-{version}/'
with zipfile.ZipFile(archive) as bundle:
    names = bundle.namelist()
    assert len(names) == len(set(names)), 'Duplicate archive paths'
    for entry in names:
        assert entry.startswith(root) and '..' not in PurePosixPath(entry).parts and '\\' not in entry, 'Unsafe archive path'
        assert not entry.startswith(root + 'data/'), 'Acceptance data entered distribution'
        assert not entry.endswith('/resources/app-update.yml'), 'Installer updater enabled'
    native = root + 'DeepSeek Harness Portable.exe'
    official_version = load('qualified-candidate.json')['version']
    asar = root + f'app/{official_version}/resources/app.asar'
    for path, expected in [(native, qualification['binarySha256']), (asar, qualification.get('adaptedAsarSha256', qualification['officialAsarSha256']))]:
        with bundle.open(path) as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected, f'Payload digest mismatch: {path}'
print(f'Verified fresh {version} distribution and exact qualified binaries')
