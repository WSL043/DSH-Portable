# Settings response latency — 2026-09-14

The settings GET previously waited for `reg.exe` to query Windows notification availability, even for the sidebar environment summary and the Updates page. This OS subprocess has a 3-second timeout. Local saved settings do not depend on that result.

New clients request local-only settings with `x-dsh-portable-settings: local-only`. Only the Desktop & data page subsequently asks for notification status. Legacy clients retain the previous response behavior. Simultaneous notification queries share one pending probe; results are not persistently cached, so a later visit observes OS setting changes. UI state ignores responses after unmount.

Environment summary consumers now initialize from the already available local snapshot instead of waiting for an in-flight update check again when mounted later.

Measurement on this Windows host, five sequential handler invocations per implementation:

| Handler | Median |
| --- | --- |
| Previous settings GET, including real registry subprocess | 11.64 ms |
| Local-only settings GET | 0.09 ms |

Evidence: `build/settings-latency-result.json`. This is an in-process route-handler microbenchmark with a small isolated state directory, not HTTP round-trip, screen paint or total startup timing. Supplementary OS checking still takes time when requested. No claim of total startup improvement is made.

30 targeted tests pass (`build/settings-latency-tests.log`). Tests hold the OS query pending, verify settings render independently, verify the later notification hint, coalesce concurrent probes, and preserve legacy response behavior. No installed package was changed and no release was published.

Existing first-start evidence was reviewed before selecting this work. Earlier shared-directory/synchronous-write candidates showed no gain; thread-pool improvements did not establish a local total-startup gain. Those rejected approaches were not repeated. Long-duration behavior remains a separate release qualification task.
