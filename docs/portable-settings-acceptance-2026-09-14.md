# Portable settings acceptance — 2026-09-14

Scope: Portable-owned settings and its export dialogs. Upstream settings implementation and the separate Updates page were not redesigned.

The settings now present desktop behavior, data transfer, isolated environments and maintenance in that order. Export scope and protection are selected in the export dialog. Encrypted export shows the actual selected scope. An operation in progress cannot dismiss the environment/import dialog and hide its progress. HTTP errors and incomplete doctor/export/repair results cannot be reported as successful.

Validation:

- 47 targeted settings, route and desktop contract tests pass. Log: `build/settings-regression-final.log`.
- Real DSH 0.1.5-rc.2 controls rendered against a separate state directory in a headless browser. The response for the existing Portable client module was replaced with the exact working-tree source in that browser only. Native capabilities were supplied by a no-op fixture for layout; no native operations were executed through that fixture.
- Inspected Chinese light main page at 1200 px, Chinese dark export at 720 px, English dark main page at 720 px and English light encrypted export at 720 px. No document horizontal overflow was reported. Screenshots: `build/settings-main.png`, `settings-export-dark.png`, `settings-english-dark.png`, `settings-encrypted-light.png`.
- The isolated first-run dialogs were dismissed before the final screenshots. No model credentials or user data were used. Test backend was stopped through its normal CLI.

This is real-control browser acceptance, not final packaged native-host acceptance. No release was published or installed application replaced. Whole-profile cache deletion and a background cache scanner remain excluded.
