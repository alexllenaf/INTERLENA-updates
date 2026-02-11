# Desktop build (macOS/Windows)

## Como ejecutar

### Desarrollo (Tauri + backend local)
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

### Build de release
```bash
# 1) Backend sidecar
pip install pyinstaller
python3 backend/build_backend.py
# Opcional para reducir tamaño:
# PYI_STRIP=1 (default) aplica --strip
# UPX_DIR=/ruta/a/upx habilita compresión UPX

# 2) Frontend
cd frontend
npm install
npm run build:desktop

# 3) App nativa
npm run tauri:build
```

## Donde estan los datos
- macOS: `~/Library/Application Support/Interview Atlas/`
- Windows: `%APPDATA%\Interview Atlas\`
- Linux: `~/.local/share/Interview Atlas/` (o `$XDG_DATA_HOME`)

Variables útiles:
- `APP_DATA_DIR`: fuerza una ruta custom para datos
- `DATABASE_URL` / `UPLOADS_DIR`: overrides explícitos

Estructura:
- `applications.db`: SQLite principal
- `uploads/`: adjuntos
- `backups/`: copias automáticas
- `state.json`: estado de versión/migraciones
- `metrics/startup.json`: tiempos de arranque

## Como actualiza
- **Updater nativo (Tauri)**: configurado en `frontend/src-tauri/tauri.conf.json`.
- **Feed JSON**: usa el formato de `update_feed.example.json` (incluye `platforms` con firma por OS).
- **Firma**: genera clave con `tauri signer` y publica la firma por build.

Comportamiento ante fallos:
- Antes de aplicar una versión nueva, se crea un backup automático.
- Si el primer arranque tras update crashea (no se marca `last_run_ok`), en el siguiente inicio se restaura el backup.
- Si la actualización falla, la app anterior sigue usando los datos (no se guardan dentro del bundle).

## Backup manual
Desde la UI: `Settings → Download backup (.zip)`.
Endpoint: `GET /api/backup/export`.

## Migraciones
`StorageManager` guarda `schema_version` en `state.json` y ejecuta migraciones con backup + rollback si fallan.
Añade nuevas migraciones en `backend/app/migrations.py`.

## Medicion de arranque
- Backend (fases + health): `python3 scripts/measure_backend_startup.py`
- UI (solo cuando quieras perf): `VITE_STARTUP_PROFILING=1 npm run dev` y revisa consola.
