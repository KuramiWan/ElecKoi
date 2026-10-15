import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('..', import.meta.url))
const setup = String.raw`
import importlib.util, io, json, tarfile, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('packager', 'scripts/android-runtime/package-runtime.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
prefix = 'node_modules/.eleckoi-packages/shared-assets@1.0.0'
inventory = {'packages': [{'name': packager.SHARED_ASSET_PACKAGE, 'directory': prefix}]}
def package(root):
    root = Path(root)
    (root / 'assets/nested').mkdir(parents=True)
    (root / 'dist/assets/nested').mkdir(parents=True)
    (root / 'package.json').write_text(json.dumps({'name': packager.SHARED_ASSET_PACKAGE, 'exports': {
        './assets/*': './assets/*', './html/*': './dist/*'}}))
    for name, value in [('library.js', b'synthetic browser library'), ('nested/model.json', b'{"synthetic":true}')]:
        (root / 'assets' / name).write_bytes(value)
        (root / 'dist/assets' / name).write_bytes(value)
    (root / 'dist/html-libraries.global.js').write_text('synthetic libraries')
    return root
`
function python(body) {
  const result = spawnSync('python', ['-c', setup + body], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, result.stderr || result.stdout).toBe(0)
}

describe('Android shared resource distribution', () => {
  it('stores resource bytes once and retains the built resource path as a portable directory link', () => python(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    source = package(temporary)
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        packager.add_directory(archive, source, prefix, packager.SHARED_ASSET_PACKAGE)
    output.seek(0)
    with tarfile.open(fileobj=output) as archive:
        packager.verify_shared_asset_layout(archive, inventory)
        link = archive.getmember(prefix + '/dist/assets')
        assert link.issym() and link.linkname == '../assets'
        assert not any(m.name.startswith(prefix + '/dist/assets/') for m in archive)
        assert archive.extractfile(prefix + '/assets/library.js').read() == b'synthetic browser library'
        assert archive.extractfile(prefix + '/dist/html-libraries.global.js').read() == b'synthetic libraries'
        assert not any(m.name.endswith('/tavern-runtime.global.js') for m in archive)
    assert (source / 'dist/assets/library.js').read_bytes() == (source / 'assets/library.js').read_bytes()
`))

  it('rejects stale or missing built resources before substituting their directory', () => python(String.raw`
with tempfile.TemporaryDirectory() as temporary:
    source = package(temporary)
    built = source / 'dist/assets/library.js'
    built.write_bytes(b'stale synthetic browser library')
    try:
        with tarfile.open(fileobj=io.BytesIO(), mode='w') as archive:
            packager.add_directory(archive, source, prefix, packager.SHARED_ASSET_PACKAGE)
    except ValueError as error:
        assert 'differs from its source' in str(error)
    else:
        raise AssertionError('Stale resource accepted')
    built.unlink()
    try:
        packager.validate_shared_asset_copies(source)
    except ValueError as error:
        assert 'inventory differs' in str(error)
    else:
        raise AssertionError('Missing resource accepted')
`))

  it('rejects the original duplicate archive and invalid or missing canonical resource paths', () => python(String.raw`
def check(build, message):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        build(archive)
    output.seek(0)
    with tarfile.open(fileobj=output) as archive:
        try:
            packager.verify_shared_asset_layout(archive, inventory)
        except ValueError as error:
            assert message in str(error), str(error)
        else:
            raise AssertionError('Invalid resource layout accepted')
def link(archive, target='../assets'):
    item = tarfile.TarInfo(prefix + '/dist/assets')
    item.type, item.linkname = tarfile.SYMTYPE, target
    archive.addfile(item)
def duplicate(archive):
    packager.add_bytes(archive, prefix + '/assets/library.js', b'synthetic')
    packager.add_bytes(archive, prefix + '/dist/assets/library.js', b'synthetic')
check(duplicate, 'must link')
check(lambda archive: (link(archive), duplicate(archive)), 'Duplicate shared resources')
check(lambda archive: link(archive), 'Canonical shared resources are missing')
check(lambda archive: (link(archive, '../../wrong'), packager.add_bytes(archive, prefix + '/assets/library.js', b'synthetic')), 'must link')
`))
})

describe('Android packaged workspace entrypoints', () => {
  it('rejects a missing runtime subpath in the final archive even when its manifest and main entry exist', () => python(String.raw`
def verify(include_media):
    output = io.BytesIO()
    prefix = 'node_modules/.eleckoi-packages/synthetic-data@1.0.0'
    inventory = {'packages': [{'name': 'synthetic-data', 'version': '1.0.0', 'directory': prefix, 'workspace': True}]}
    with tarfile.open(fileobj=output, mode='w') as archive:
        packager.add_bytes(archive, prefix + '/package.json', json.dumps({
            'name': 'synthetic-data', 'version': '1.0.0', 'main': './lib/index.js', 'exports': {
                '.': {'types': './lib/index.d.ts', 'default': './lib/index.js'}, './media': './lib/media.js',
                './assets/*': './assets/*'}}).encode())
        packager.add_bytes(archive, prefix + '/lib/index.js', b'export const data = true')
        packager.add_bytes(archive, prefix + '/assets/example.json', b'{}')
        if include_media:
            packager.add_bytes(archive, prefix + '/lib/media.js', b'export const media = true')
    output.seek(0)
    with tarfile.open(fileobj=output) as archive:
        packager.verify_workspace_entrypoints(archive, inventory)
verify(True)
try:
    verify(False)
except ValueError as error:
    assert 'synthetic-data -> ./lib/media.js' in str(error), str(error)
else:
    raise AssertionError('Missing runtime module accepted')
`))
})
