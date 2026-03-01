# Interview Atlas — Update Feed

Public update feed and release assets for **Interview Atlas**.

## Installation (macOS)

### Homebrew (recommended)

```bash
brew tap alexllenaf/interlena
brew install --cask interlena
```

### Direct download

1. Go to [Releases](https://github.com/alexllenaf/INTERLENA-updates/releases/latest).
2. Download `Interview.Atlas-arm64.dmg` (Apple Silicon) or `Interview.Atlas-x64.dmg` (Intel).
3. Open the `.dmg` and drag **Interview Atlas** to `/Applications`.
4. If macOS shows a security warning, right-click the app → **Open**, or go to
   *System Settings → Privacy & Security → Open Anyway*.

## Auto-updates

The desktop app checks this repository's `latest.json` automatically.
No manual action is needed — you'll see a banner when a new version is available.

## About

Interview Atlas is a 100 % local, privacy-first job-application tracker.
No telemetry, no cloud dependency.

- **Frontend:** React + TypeScript (Tauri shell)
- **Backend:** FastAPI + SQLite (embedded sidecar)

## License

Copyright © 2026 Alex Llena Fernandez. All rights reserved.  
See [LICENSE](LICENSE).
