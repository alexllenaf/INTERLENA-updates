#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};
use tauri::api::process::{Command, CommandEvent};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_READY_TIMEOUT: Duration = Duration::from_secs(15);
const BACKEND_READY_POLL: Duration = Duration::from_millis(120);

fn wait_for_backend_ready(port: &str, timeout: Duration) -> bool {
    let addr = format!("{BACKEND_HOST}:{port}");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        thread::sleep(BACKEND_READY_POLL);
    }
    false
}

fn spawn_backend(app: &tauri::App) -> bool {
    let port = std::env::var("APP_PORT").unwrap_or_else(|_| "8000".to_string());
    if wait_for_backend_ready(&port, Duration::from_millis(250)) {
        eprintln!("backend: Reusing existing backend on {BACKEND_HOST}:{port}");
        return true;
    }

    let feed_url = std::env::var("UPDATE_FEED_URL").unwrap_or_else(|_| {
        "https://github.com/alexllenaf/INTERLENA-updates/releases/latest/download/latest.json"
            .to_string()
    });
    let version = app.package_info().version.to_string();
    let mut envs = HashMap::new();
    envs.insert("APP_VERSION".to_string(), version);
    envs.insert("UPDATE_FEED_URL".to_string(), feed_url);
    let sidecar = Command::new_sidecar("interview-atlas-backend")
        .map(|cmd| {
            cmd.args(["--host", "127.0.0.1", "--port", &port])
                .envs(envs)
                .spawn()
        });

    let started = match sidecar {
        Ok(Ok((mut rx, _child))) => {
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stderr(line) | CommandEvent::Stdout(line) => {
                            eprintln!("backend: {line}");
                        }
                        _ => {}
                    }
                }
            });
            true
        }
        Ok(Err(err)) => {
            eprintln!("Failed to spawn backend sidecar: {err}");
            false
        }
        Err(err) => {
            eprintln!("Failed to resolve backend sidecar: {err}");
            false
        }
    };

    if !started {
        return false;
    }

    if !wait_for_backend_ready(&port, BACKEND_READY_TIMEOUT) {
        eprintln!(
            "Backend sidecar did not become ready on {BACKEND_HOST}:{port} within {:?}",
            BACKEND_READY_TIMEOUT
        );
        return false;
    }

    true
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if !spawn_backend(app) {
                eprintln!("Desktop backend failed to initialize correctly.");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
