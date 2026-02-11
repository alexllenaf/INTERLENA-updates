#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use tauri::api::process::{Command, CommandEvent};

fn spawn_backend(app: &tauri::App) {
    let port = std::env::var("APP_PORT").unwrap_or_else(|_| "8000".to_string());
    let version = app.package_info().version.to_string();
    let mut envs = HashMap::new();
    envs.insert("APP_VERSION".to_string(), version);
    let sidecar = Command::new_sidecar("interview-atlas-backend")
        .map(|cmd| {
            cmd.args(["--host", "127.0.0.1", "--port", &port])
                .envs(envs)
                .spawn()
        });

    match sidecar {
        Ok(Ok((mut rx, _child))) => {
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stderr(line) = event {
                        eprintln!("backend: {line}");
                    }
                }
            });
        }
        Ok(Err(err)) => {
            eprintln!("Failed to spawn backend sidecar: {err}");
        }
        Err(err) => {
            eprintln!("Failed to resolve backend sidecar: {err}");
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            spawn_backend(_app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
