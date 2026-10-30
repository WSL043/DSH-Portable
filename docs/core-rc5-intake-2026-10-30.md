# Upstream core intake: 0.2.1-rc.5

- Compared lock: `upstream.lock.json`
- Mode: `--record-shape` (all five checks required)
- Overall checks: **PASS**
- Intake verdict: `same-shape`

## Checks

### 1. Official tag commit and npm dist.integrity — PASS

tag dsh-v0.2.1-rc.5 -> b830ec950faba0a46dda564be3e2d854afed94f1; npm @deepseek-ai/dsh@0.2.1-rc.5 dist.integrity=sha512-WkyJZv4zl9sCAxSzRctGm58m0rilGqwR6pniBiLOz5CPDfHfDuAUicg0AAazXI7oj/Cph6/cjNTncA/rpLTXpw==; independently observed, not a provenance claim

### 2. Differences from upstream.lock.json — PASS

4 field(s) differ: [{"field":"version","current":"0.2.1-rc.4","candidate":"0.2.1-rc.5"},{"field":"tag","current":"dsh-v0.2.1-rc.4","candidate":"dsh-v0.2.1-rc.5"},{"field":"reviewedCommit","current":"504a01a9578abc2c6f1fb896b1dc322c9fe24f66","candidate":"b830ec950faba0a46dda564be3e2d854afed94f1"},{"field":"integrity","current":"sha512-8gxl6zOi6vx1sDolH+vjh9txrpbXD+t74Z2YfWkEBtR3xP2YEtk0bbLkgLZRnYQgDxCoXitXyXDKn5k0+6iXrg==","candidate":"sha512-WkyJZv4zl9sCAxSzRctGm58m0rilGqwR6pniBiLOz5CPDfHfDuAUicg0AAazXI7oj/Cph6/cjNTncA/rpLTXpw=="}]

### 3. Historical-session migration identities — PASS

packages/session/session-format-v0-to-v1/src/validation.ts=762ed963f73c7159f5309176cc69b11db25ac634 (expected 762ed963f73c7159f5309176cc69b11db25ac634); packages/session/session-format-v0-to-v1/src/payload-validation.ts=5b19f7cc6668d8e9bfc1c75806d3898132eb94ee (expected 5b19f7cc6668d8e9bfc1c75806d3898132eb94ee); lib/index.js sha256=1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1 (expected 1b3bff6aaf28ca62a864cf97b9aa9aa45ab76de5e459f7881ba4bc8de73490b1); candidate version=0.2.1-rc.5 (exact version string); migration inputs=same-shape

### 4. Official release package-family counts — PASS

lock old={"dsh":344,"vendor":9,"landlock":0}; official candidate={"dsh":344,"vendor":9,"landlock":0}

### 5. Official Plugin Manager capabilities or legacy adapter anchors — PASS

patchPluginManagerActions accepted the official bundle; package version=0.2.1-rc.5; bundle sha256=61beea0fe856b054fe9dee4cfa5492f54df973ffd18ab85d5ea37beff52991d1

## Stable-line note

稳定线采用前仍需人工接入记录；stable-release-readiness.json 的证据要求不变。

--record-shape added exact version 0.2.1-rc.5 to config/historical-descriptor-versions.json

VERDICT=same-shape

## Required migration and delivery acceptance

This intake authenticates RC5 source and package identities and the reviewed migration input shape. It does not transfer RC4 runtime results or qualify RC5 publication. `stable-release-readiness.json` intentionally retains its original RC4 record and publication remains blocked until exact RC5 runtime evidence is recorded.

The product Build workflow invokes `scripts/verify-historical-session.mjs <staged-app> <selected-upstream-lock>` from each Windows, macOS and Linux build. Run the final integrated product CI on all five targets and retain the emitted JSON containing exact RC5 `coreProvenance`, the exact compatibility patch, released 0.1.1-rc.2 writer checks, actual deterministic continuation, persistence save/reopen, interrupted-journal recovery and unchanged original historical files. Update readiness only from those successful results. The probe makes zero real model calls and does not establish physical power-loss or second-machine coverage.

The matching exact Native Windows UI, plugin preservation, update/rollback, dependency security and signed publication/readback gates remain separate requirements. The source intake leaves both default-plugin tables and product version unchanged.
