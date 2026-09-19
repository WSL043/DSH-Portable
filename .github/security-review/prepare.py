"""Reproduce the reviewed native fixes and a checksum-pinned glib backport."""
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[2]

def replace_once(path, before, after):
    text = path.read_text()
    if after in text and before not in text:
        return
    if text.count(before) != 1:
        raise RuntimeError(f"Reviewed source no longer matches: {path}")
    path.write_text(text.replace(before, after, 1))

replace_once(root / 'launcher/windows/DSH-Portable.cs',
    'string helper = Path.Combine(Path.GetTempPath(), "DSH-FullUpdater-" + Process.GetCurrentProcess().Id + ".exe");\n            File.Copy(source, helper, true);',
    'string helper = Path.Combine(Path.GetTempPath(), "DSH-FullUpdater-" + Guid.NewGuid().ToString("N") + ".exe");\n            File.Copy(source, helper, false);')
replace_once(root / 'launcher/windows/PortableProcessJob.cs',
    'WorkingDirectory = System.IO.Path.GetTempPath(),\n                    UseShellExecute = true,',
    'WorkingDirectory = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(executable)),\n                    UseShellExecute = false,')

vendor = root / 'launcher/linux/vendor/glib-0.18.5'
checksum = '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5'
if not vendor.exists():
    payload = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location',
        '--proto', '=https', '--max-time', '120',
        'https://static.crates.io/crates/glib/glib-0.18.5.crate'])
    if hashlib.sha256(payload).hexdigest() != checksum:
        raise RuntimeError('glib crate does not match the existing Cargo.lock checksum')
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        for member in archive.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != 'glib-0.18.5' or '..' in parts or Path(member.name).is_absolute():
                raise RuntimeError('Unsafe crate member')
            target = vendor.joinpath(*parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
            else:
                raise RuntimeError('Unexpected non-regular crate member')
source = vendor / 'src/variant_iter.rs'
replace_once(source, 'let p: *mut libc::c_char = std::ptr::null_mut();',
             'let mut p: *mut libc::c_char = std::ptr::null_mut();')
replace_once(source, '                &p,\n                std::ptr::null::<i8>(),',
             '                &mut p,\n                std::ptr::null::<i8>(),')
(vendor / 'PORTABLE-PATCH.md').write_text('''# glib 0.18.5 compatibility backport

Original crate: https://static.crates.io/crates/glib/glib-0.18.5.crate
SHA-256: 233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5

RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g is repaired with the exact two-line
upstream change from https://github.com/gtk-rs/gtk-rs-core/pull/1343:
`VariantStrIter::impl_get` passes a mutable output pointer (`let mut p`, `&mut p`).
The version remains 0.18.5; it is not relabeled as 0.20.0. Cargo's local patch
selects this crate for the existing GTK3/Tauri dependency family. Upstream
licenses and source are retained. The added optimized regression exercises
next, next_back, nth, nth_back and last, including Unicode and empty strings.

Remove this compatibility backport when the Linux native dependency family
can move to an upstream release containing the fix. A changed dependency graph
or a green source test is not a native release-artifact acceptance result.
''')
(vendor / 'tests').mkdir(exist_ok=True)
(vendor / 'tests/portable_variant_str_iter.rs').write_text('''use glib::variant::ToVariant;

#[test]
fn portable_optimized_variant_string_iteration() {
    let strings = ["", "alpha", "日本語", "中文", "omega"];
    let value = strings.to_variant();
    assert_eq!(value.array_iter_str().unwrap().collect::<Vec<_>>(), strings);
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next_back(), Some("omega"));
    assert_eq!(iter.nth(1), Some("日本語"));
    assert_eq!(iter.nth_back(0), Some("中文"));
    assert_eq!(iter.next(), None);
    assert_eq!(value.array_iter_str().unwrap().last(), Some("omega"));
    let empty: [&str; 0] = [];
    assert_eq!(empty.to_variant().array_iter_str().unwrap().next(), None);
}
''')
manifest = root / 'launcher/linux/Cargo.toml'
patch = '\n[patch.crates-io]\nglib = { path = "vendor/glib-0.18.5" }\n'
text = manifest.read_text()
if '[patch.crates-io]' not in text:
    manifest.write_text(text + patch)
elif 'glib = { path = "vendor/glib-0.18.5" }' not in text:
    raise RuntimeError('Unexpected Cargo patch configuration')
lock = root / 'launcher/linux/Cargo.lock'
text = lock.read_text()
old = 'name = "glib"\nversion = "0.18.5"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "' + checksum + '"\n'
if old in text:
    replace_once(lock, old, 'name = "glib"\nversion = "0.18.5"\n')
elif 'name = "glib"\nversion = "0.18.5"\ndependencies' not in text:
    raise RuntimeError('Unexpected glib lock entry')
print('Prepared native fixes and checksum-verified glib compatibility backport')
