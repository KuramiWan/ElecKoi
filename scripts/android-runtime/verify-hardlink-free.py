#!/usr/bin/env python3
"""Compare the unchanged Linux base and the checksum-locked Android glibc overlay."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--archive', required=True)
parser.add_argument('--report', required=True)
parser.add_argument('--glibc-directory')
args = parser.parse_args()

def digest_stream(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()

def read_archive(path):
    records = {}
    hardlinks = []
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            if member.name in records:
                raise ValueError(f'Duplicate archive member: {member.name}')
            record = {'type': 'file' if member.isfile() or member.islnk() else member.type.decode('ascii'),
                'mode': member.mode, 'uid': member.uid, 'gid': member.gid}
            if member.isfile() or member.islnk():
                with archive.extractfile(member) as stream:
                    record['sha256'] = digest_stream(stream)
                if member.islnk():
                    hardlinks.append({'name': member.name, 'target': member.linkname})
            elif member.issym():
                record['target'] = member.linkname
            records[member.name] = record
    return records, hardlinks

report = {'schemaVersion': 1, 'source': args.source, 'archive': args.archive, 'pass': False}
try:
    before, source_links = read_archive(args.source)
    after, target_links = read_archive(args.archive)
    if args.glibc_directory:
        stage = Path(args.glibc_directory)
        for file in sorted((stage / 'usr/glibc/lib').glob('*')):
            name = file.relative_to(stage).as_posix()
            expected = {'type': 'file', 'mode': 0o755, 'uid': 0, 'gid': 0,
                        'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
            if after.pop(name, None) != expected:
                raise ValueError(f'Android glibc overlay differs from verified staging: {name}')
    if target_links:
        raise ValueError(f'Archive still has {len(target_links)} hardlinks: {target_links}')
    if before != after:
        missing = sorted(set(before) - set(after))
        extra = sorted(set(after) - set(before))
        changed = [name for name in before.keys() & after.keys() if before[name] != after[name]]
        raise ValueError(f'Linux base changed beyond hardlink expansion: missing={missing[:8]} extra={extra[:8]} changed={changed[:8]}')
    report.update({'pass': True, 'members': len(after), 'sourceHardlinks': source_links,
        'archiveHardlinks': 0, 'symlinks': sum(record['type'] == '2' for record in after.values()),
        'checks': ['member-set', 'file-bytes-sha256', 'modes', 'uid-gid', 'symlink-targets', 'zero-hardlinks']})
except Exception as error:
    report['error'] = str(error)
finally:
    destination = Path(args.report)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
if not report['pass']:
    raise SystemExit(1)
