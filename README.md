# Personal Interview & Application Tracker

Aplicación local con frontend en React + TypeScript y backend en FastAPI, con soporte para SQLite o Postgres.

## Requisitos
- Python 3.10+
- Node.js 18+

## Instalación macOS (Interlena)
### 1) Instalación con Homebrew (tap propio)
```bash
brew tap alexllenaf/interlena
brew install --cask interlena
```

### 2) Instalación por descarga directa
1. Descarga el archivo `.dmg` desde GitHub Releases.
2. Abre el `.dmg` y arrastra `Interlena.app` a `/Applications`.
3. Si macOS muestra un aviso de seguridad ("developer cannot be verified"), haz `Ctrl + click` sobre `Interlena.app` y selecciona `Open`.
4. Alternativa: `System Settings` -> `Privacy & Security` -> `Open Anyway`.

## Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Opcional para Postgres:
```bash
pip install psycopg[binary]
```

Variables útiles:
- `DATABASE_URL` (default: `sqlite:///./data/applications.db`)
- `CORS_ORIGINS` (default: `http://localhost:5173,http://127.0.0.1:5173`)

## Frontend (React + TypeScript)
```bash
cd frontend
npm install
npm run dev
```

La app abrirá en `http://localhost:5173` y se comunica con el backend en `http://localhost:8000`.

## Datos
- SQLite por defecto (app de escritorio): `~/Library/Application Support/Interview Atlas/applications.db` (macOS) o `%APPDATA%\\Interview Atlas\\applications.db` (Windows).
- En desarrollo/local (web): se usa la ruta estándar de la plataforma; puedes forzarla con `APP_DATA_DIR=/ruta/custom`.
- Si quieres Postgres, define `DATABASE_URL=postgresql+psycopg://user:pass@host:5432/dbname`

## Exportación
- Excel (All / Favorites / Active)
- ICS para entrevistas y follow-ups
- Backup manual: Settings → “Download backup (.zip)”

## Notas
- 100% local, sin telemetría.
- El diseño prioriza una UX tipo Notion/Airtable con módulos de analítica.

## Actualizaciones (macOS)
- Publica `latest.json` + `Interview.Atlas.app.tar.gz` + `Interview.Atlas.app.tar.gz.sig` para el updater de Tauri.
- Publica `Interview.Atlas.dmg` (compatibilidad) y también `Interview.Atlas-arm64.dmg` + `Interview.Atlas-x64.dmg` para descarga manual según arquitectura.
- El JSON de update usa `url`/`download_url` para el `.dmg` y `platforms.*.url` para el `.tar.gz` firmado.
- Define `UPDATE_FEED_URL` apuntando a ese JSON (lo usa el banner de la UI).
- La app de escritorio usa el updater nativo de Tauri (ver `frontend/src-tauri/tauri.conf.json`).
- Opcional: `UPDATE_NOTIFY=0` para desactivar la notificación de macOS.
- Firma/notarización Apple es opcional en CI: sin esos secrets la app puede abrir con aviso "developer cannot be verified".
- Workflow CI/CD: `.github/workflows/release-macos-updates.yml`.

## Desktop (macOS/Windows) con Tauri
Requisitos: Rust + Node.js + Python 3.10+.

1) Construir backend (sidecar)
```bash
pip install pyinstaller
python3 backend/build_backend.py
```

2) Construir frontend para escritorio
```bash
cd frontend
npm install
npm run build:desktop
```

3) Construir app nativa
```bash
cd frontend
npm run tauri:build
```

Dev rápido (Tauri + backend local):
```bash
# Terminal 1
cd backend
pip install -r requirements.txt
python3 desktop_entry.py

# Terminal 2
cd frontend
npm install
npm run tauri:dev
```

Detalles: `docs/DESKTOP.md`.

## Legacy (Streamlit)
El código original en Streamlit se mantiene en `app.py` y `run_app.py` por compatibilidad.

## License
Copyright (c) 2026 Alex Llena Fernandez. All rights reserved.

See `LICENSE`.
