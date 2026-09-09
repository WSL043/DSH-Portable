# Website scene and screenshots

The website uses a monochrome Three.js scene with drifting fog and a screen-space water reflection. The product panel displays actual interface captures. Pointer movement gently tilts it; the water samples the same rendered frame, so the reflection follows the panel without a second animation state.

This is a visual presentation, not a running DSH instance. The previous simulated plugin-installation and folder-movement demo has been removed. No model calls, plugin execution, or filesystem access occurs on the site.

## Rendering and accessibility

- Light and dark appearance share a 2.2-second transition. The preference persists, with an option to follow the system.
- Motion follows the system reduced-motion preference unless the visitor explicitly overrides it. Disabling motion also disables pointer tilt.
- Rendering pauses when the hero leaves the viewport or the tab is hidden. Static screenshots remain visible if WebGL cannot start or its context is lost.
- The fog is rendered at reduced resolution; the panel and its reflection use a separate antialiased target. Three.js r186 is vendored under its MIT license in `site/vendor/`.
- Screenshot sources are `assets/dsh-interface-zh.png`, `assets/dsh-interface-en.png`, and `assets/dsh-workspace-0.6.4.png`. Light and dark captures currently show different upstream versions; they are not recolored or presented as a live product session.

## Publishing

`node scripts/build-site.mjs` builds both language routes into `build/site`. The Website workflow runs the site contract and Chromium acceptance checks before deploying that directory to GitHub Pages. A website push does not publish a Portable software release.

Run browser checks with `node scripts/check-site-browser.mjs` after installing Playwright 1.62.1 and its Chromium browser. `PLAYWRIGHT_MODULE` may point to an existing Playwright module for local checks. Evidence is written to `build/site-acceptance`, outside the deployed directory.
