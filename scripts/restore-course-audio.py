"""Restore an immutable release asset; never generate audio or read credentials."""
import hashlib
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
spec = json.loads((root / '.github/course-audio.json').read_text())
archive = Path(sys.argv[1])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == spec['sha256'], 'Audio archive checksum mismatch'
with tempfile.TemporaryDirectory() as temp:
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            path = Path(entry.filename)
            assert not path.is_absolute() and '..' not in path.parts, 'Unsafe archive path'
            assert entry.file_size < 25 * 1024 * 1024, 'Audio file too large'
            if entry.filename.startswith('data/course-audio/'):
                bundle.extract(entry, temp)
    source = Path(temp) / 'data/course-audio'
    manifest = json.loads((source / 'manifest.json').read_text())
    assert len(manifest) == spec['recordings'], 'Audio count mismatch'
    target = root / 'data/course-audio'
    target.mkdir(parents=True, exist_ok=True)
    prior = json.loads((target / 'manifest.json').read_text()) if (target / 'manifest.json').exists() else {}
    for key, entry in manifest.items():
        generation = entry['generationId']
        assert len(generation) == 64 and all(c in '0123456789abcdef' for c in generation)
        assert entry['url'] == f'/audio/{generation}.mp3'
        asset = source / f'{generation}.mp3'
        assert hashlib.sha256(asset.read_bytes()).hexdigest() == entry['sha256'], 'Recording checksum mismatch'
        assert key not in prior or prior[key] == entry, 'Divergent audio entry'
        shutil.copyfile(asset, target / asset.name)
    prior.update(manifest)
    (target / 'manifest.json').write_text(json.dumps(prior))
print(f'Restored {len(manifest)} verified recordings; preserved {len(prior)} total.')
