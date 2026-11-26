//! Non-blocking silent background update check against GitHub Releases (D-0011).

use csdm_core::ui_values::{GITHUB_RELEASES_LATEST_URL, UPDATE_CONNECT_TIMEOUT_S, UPDATE_HTTP_TIMEOUT_S};
use csdm_core::update::{parse_github_release, UpdateInfo};
use std::process::Command;
use std::sync::mpsc::{channel, Receiver};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Queries `url` for a newer GitHub release via `curl.exe`. Any network, offline, or parse
/// error returns `None` silently.
pub fn fetch_latest_with(current_version: &str, url: &str) -> Option<UpdateInfo> {
    let mut cmd = Command::new("curl.exe");
    cmd.args([
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        &UPDATE_HTTP_TIMEOUT_S.to_string(),
        "--connect-timeout",
        &UPDATE_CONNECT_TIMEOUT_S.to_string(),
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "User-Agent: CSDM-batch-clip-generator",
        url,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let body = std::str::from_utf8(&out.stdout).ok()?;
    parse_github_release(body, current_version)
}

/// Spawns one background thread that checks GitHub Releases silently and reports once.
pub fn spawn_check(current_version: &str) -> Receiver<Option<UpdateInfo>> {
    let (tx, rx) = channel();
    let version = current_version.to_string();
    std::thread::spawn(move || {
        let _ = tx.send(fetch_latest_with(&version, GITHUB_RELEASES_LATEST_URL));
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn offline_port_fails_silently_with_none() {
        assert_eq!(fetch_latest_with("5.0.0", "http://127.0.0.1:1/releases/latest"), None);
    }

    #[test]
    fn local_server_returns_newer_release_or_ignores_older() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = r#"{"tag_name":"v5.2.0","html_url":"https://github.com/aznan-triks/CSDM-batch-clip-generator/releases/tag/v5.2.0","draft":false,"prerelease":false}"#;
        let handle = std::thread::spawn(move || {
            for _ in 0..2 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buf = [0u8; 512];
                    let _ = stream.read(&mut buf);
                    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                    let _ = stream.write_all(resp.as_bytes());
                }
            }
        });
        let url = format!("http://{addr}/releases/latest");
        assert_eq!(
            fetch_latest_with("5.0.0", &url),
            Some(UpdateInfo {
                version: "5.2.0".into(),
                url: "https://github.com/aznan-triks/CSDM-batch-clip-generator/releases/tag/v5.2.0".into(),
            })
        );
        assert_eq!(fetch_latest_with("5.2.0", &url), None);
        let _ = handle.join();
    }
}
