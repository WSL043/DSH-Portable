# glib 0.18.5 compatibility backport

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
