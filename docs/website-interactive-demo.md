# Website interaction scope

The public website uses a local, in-memory workflow illustration. It demonstrates plugin selection and same-platform folder movement while preserving the selected sample state. It does not run DSH, install packages, call a model, or read local files. Reload resets it. The notice remains visible below the demo in both languages.

Product screenshots are separate from the illustration. They retain their original UI pixels and are not proof of a live browser-hosted DSH instance.

## A real embedded DSH environment

An iframe alone cannot provide this on GitHub Pages: DSH needs its host service, and a visitor's localhost is not a public demo backend. Do not embed the maintainer's running instance or ask visitors to paste credentials into the marketing site.

A future real trial should use a separate deployment, disposable per-visitor workspaces, a bounded set of plugins, no host secrets, and explicit resource limits and expiry. If model calls are offered, credentials and cost ownership need a separate product decision. Native window behavior and folder portability would still need the downloaded application.

For the current site, use the lightweight workflow illustration plus real screenshots. No video generation or Remotion dependency is needed for these interactions. Animation is limited to navigation, screenshot transitions, and existing motion settings; it must not hide essential content.
