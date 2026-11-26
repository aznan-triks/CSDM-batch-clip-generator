//! Silent background release-check parsing and semver comparison (D-0011). Pure: no I/O.

use crate::ui_values::GITHUB_RELEASES_ALLOWED_PREFIX;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

fn parse_version(raw: &str) -> Option<([u32; 3], bool)> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    let (core, is_pre) = match trimmed.split_once('-') {
        Some((c, _)) => (c, true),
        None => (trimmed, false),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    let patch = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(([major, minor, patch], is_pre))
}

/// True when `latest` is strictly newer than `current` (e.g. `"v5.0.1"` > `"5.0.0"` or `"v5.0.0"` > `"5.0.0-dev"`).
pub fn is_newer_version(latest: &str, current: &str) -> bool {
    let (Some((l, l_pre)), Some((c, c_pre))) = (parse_version(latest), parse_version(current)) else {
        return false;
    };
    l > c || (l == c && c_pre && !l_pre)
}

/// Extracts a valid, non-draft, non-prerelease update newer than `current_version`.
pub fn parse_github_release(body: &str, current_version: &str) -> Option<UpdateInfo> {
    let v: Value = serde_json::from_str(body).ok()?;
    if v.get("draft").and_then(Value::as_bool) == Some(true) || v.get("prerelease").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let tag = v.get("tag_name").and_then(Value::as_str)?.trim();
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    let url = v.get("html_url").and_then(Value::as_str)?.trim().to_string();
    if !url.starts_with(GITHUB_RELEASES_ALLOWED_PREFIX) || !is_newer_version(&version, current_version) {
        return None;
    }
    Some(UpdateInfo { version, url })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_cleanly() {
        assert!(is_newer_version("v5.0.1", "5.0.0"));
        assert!(is_newer_version("5.1.0", "5.0.9"));
        assert!(is_newer_version("v5.0.0", "5.0.0-dev"));
        assert!(!is_newer_version("v3.5.3", "5.0.0-dev"));
        assert!(!is_newer_version("v5.0.0", "5.0.0"));
        assert!(!is_newer_version("bad", "5.0.0"));
    }

    #[test]
    fn parses_valid_github_release_and_filters_invalid() {
        let ok = r#"{"tag_name":"v5.1.0","html_url":"https://github.com/aznan-triks/CSDM-batch-clip-generator/releases/tag/v5.1.0","draft":false,"prerelease":false}"#;
        assert_eq!(
            parse_github_release(ok, "5.0.0-dev"),
            Some(UpdateInfo {
                version: "5.1.0".into(),
                url: "https://github.com/aznan-triks/CSDM-batch-clip-generator/releases/tag/v5.1.0".into(),
            })
        );
        let pre = r#"{"tag_name":"v5.2.0","html_url":"https://github.com/aznan-triks/CSDM-batch-clip-generator/releases/tag/v5.2.0","draft":false,"prerelease":true}"#;
        assert_eq!(parse_github_release(pre, "5.0.0"), None);
        let evil_url = r#"{"tag_name":"v5.2.0","html_url":"https://evil.example/tag","draft":false,"prerelease":false}"#;
        assert_eq!(parse_github_release(evil_url, "5.0.0"), None);
        assert_eq!(parse_github_release("not json", "5.0.0"), None);
    }
}
