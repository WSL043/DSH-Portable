DeepSeek-Herness
================

DeepSeek-Herness runs the official DeepSeek Harness Web interface.

Drag both applications into Applications. Open DeepSeek-Herness to start or
reopen the interface. Open Stop DeepSeek-Herness before updating or removing
the application.

Settings, credentials, sessions, browser state, and the default workspace are
stored outside the signed app bundle in:

  ~/Library/Application Support/DeepSeek-Herness

Removing the applications leaves this data folder in place so an update cannot
silently delete your work. Remove it manually only if you also want to erase
all local DSH data.

The applications are ad-hoc signed but not Apple-notarized. On first launch,
macOS can require Control-click, Open, then Open again.

DSH binds only to 127.0.0.1. Telemetry is disabled by this launcher. The data
folder can contain API credentials and private conversations.

This package contains the official DeepSeek Harness runtime plus an independent
desktop launcher. It is not an official DeepSeek desktop release.
