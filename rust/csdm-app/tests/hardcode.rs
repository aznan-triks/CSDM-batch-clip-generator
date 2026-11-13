//! Hardcode guard (HC.1, ticket 11): outside `csdm-core`, a numeric literal
//! other than 0, 1, 2, a path or a network address is refused, unless it sits
//! - in a named constant (`const` / `static` item, all its lines),
//! - in a generated file (first line holds `@generated`),
//! - in tests (`tests/` folders, and everything from `#[cfg(test)]` to the end
//!   of a file: keep test modules last),
//! - on a line carrying `// allow-hardcode: <reason>`.
//!
//! Reads every `src/**/*.rs` of the workspace with a small lexer (strings,
//! chars, lifetimes, comments), so text inside comments never counts.

use std::path::{Path, PathBuf};

const EXEMPT_CRATES: [&str; 1] = ["csdm-core"];
const ALLOW_MARK: &str = "allow-hardcode:";
const GENERATED_MARK: &str = "@generated";
const TEST_CUTOFF: &str = "#[cfg(test)]";
const ALLOWED_NUMBERS: [f64; 3] = [0.0, 1.0, 2.0];

#[derive(Default, Debug)]
struct Line {
    code: String,
    /// String literal contents, and whether the literal was raw (`r"…"`).
    strings: Vec<(String, bool)>,
    comment: String,
}

/// Splits Rust source into lines of code (string contents removed), string literals and comments.
fn lex(src: &str) -> Vec<Line> {
    let chars: Vec<char> = src.chars().collect();
    let mut lines = vec![Line::default()];
    let mut i = 0;
    let at = |i: usize| chars.get(i).copied().unwrap_or('\0');
    while i < chars.len() {
        let c = chars[i];
        let last = lines.last_mut().unwrap();
        if c == '\n' {
            lines.push(Line::default());
            i += 1;
        } else if c == '/' && at(i + 1) == '/' {
            while i < chars.len() && chars[i] != '\n' {
                last.comment.push(chars[i]);
                i += 1;
            }
        } else if c == '/' && at(i + 1) == '*' {
            let mut depth = 0;
            loop {
                if i >= chars.len() { break; }
                if chars[i] == '/' && at(i + 1) == '*' { depth += 1; i += 2; continue; }
                if chars[i] == '*' && at(i + 1) == '/' { depth -= 1; i += 2; if depth == 0 { break; } continue; }
                if chars[i] == '\n' { lines.push(Line::default()); }
                i += 1;
            }
        } else if c == '"' || ((c == 'r' || c == 'b') && is_string_start(&chars, i)) {
            let start_line = lines.len() - 1;
            let mut j = i;
            if chars[j] == 'b' { j += 1; }
            let raw = chars[j] == 'r';
            if raw { j += 1; }
            let mut hashes = 0;
            while chars[j] == '#' { hashes += 1; j += 1; }
            j += 1; // opening quote
            let mut text = String::new();
            loop {
                if j >= chars.len() { break; }
                let d = chars[j];
                if !raw && d == '\\' { text.push(d); text.push(at(j + 1)); if at(j + 1) == '\n' { lines.push(Line::default()); } j += 2; continue; }
                if d == '"' && (0..hashes).all(|k| at(j + 1 + k) == '#') { j += 1 + hashes; break; }
                if d == '\n' { lines.push(Line::default()); }
                text.push(d);
                j += 1;
            }
            lines[start_line].code.push_str("\"\"");
            lines[start_line].strings.push((text, raw));
            i = j;
        } else if c == '\'' {
            // char literal ('x', '\n', '\u{1F}') or lifetime ('a)
            let close = if at(i + 1) == '\\' { (i + 2..chars.len()).find(|&k| chars[k] == '\'') } else if at(i + 2) == '\'' { Some(i + 2) } else { None };
            match close {
                Some(k) => { last.code.push_str("' '"); i = k + 1; }
                None => { last.code.push(c); i += 1; }
            }
        } else if (c.is_alphanumeric() || c == '_') && !c.is_ascii_digit() {
            // identifiers whole, so `r`/`b` inside a name never start a string
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                lines.last_mut().unwrap().code.push(chars[i]);
                i += 1;
            }
        } else {
            last.code.push(c);
            i += 1;
        }
    }
    lines
}

fn is_string_start(chars: &[char], i: usize) -> bool {
    if i > 0 && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '_') { return false; }
    let mut j = i;
    if chars[j] == 'b' { j += 1; }
    if chars.get(j) == Some(&'r') { j += 1; while chars.get(j) == Some(&'#') { j += 1; } }
    j > i && chars.get(j) == Some(&'"')
}

/// Numeric literals of a code line that are not 0, 1 or 2 (tuple fields `.3` excluded).
fn bad_numbers(code: &str) -> Vec<String> {
    let b: Vec<char> = code.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let prev = if i > 0 { b[i - 1] } else { ' ' };
        if b[i].is_ascii_digit() && !(prev.is_alphanumeric() || prev == '_') {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == '_' || (b[i] == '.' && b.get(i + 1).is_some_and(char::is_ascii_digit))) {
                i += 1;
            }
            let token: String = b[start..i].iter().collect();
            if prev == '.' && start >= 2 && b[start - 2] != '.' { continue; } // tuple field, not a range end
            let digits: String = token.chars().filter(|c| *c != '_').collect();
            let value = digits.as_str();
            // Longest suffixes first (`u128` before `u8`); hex/octal/binary never parse, so they count.
            let number = ["i128", "u128", "isize", "usize", "i16", "i32", "i64", "u16", "u32", "u64", "f32", "f64", "i8", "u8"]
                .iter()
                .find_map(|s| value.strip_suffix(s))
                .unwrap_or(value);
            if !number.parse::<f64>().is_ok_and(|n| ALLOWED_NUMBERS.contains(&n)) {
                out.push(token);
            }
        } else {
            i += 1;
        }
    }
    out
}

/// A string literal that names a file-system path or a network address.
fn is_path_or_address(text: &str, raw: bool) -> bool {
    let c: Vec<char> = text.chars().collect();
    let drive = c.len() >= 3 && c[0].is_ascii_alphabetic() && c[1] == ':' && (c[2] == '\\' || c[2] == '/');
    let backslash = if raw { text.contains('\\') } else { text.contains("\\\\") };
    let rooted = ["/", "./", "../", "~/"].iter().any(|p| text.starts_with(p));
    let env_var = text.starts_with('%') && text[1..].contains('%');
    let ipv4 = text.split(|ch: char| !(ch.is_ascii_digit() || ch == '.')).any(|t| {
        let parts: Vec<&str> = t.split('.').collect();
        parts.len() == 4 && parts.iter().all(|p| !p.is_empty() && p.parse::<u8>().is_ok())
    });
    drive || backslash || rooted || env_var || ipv4 || text.contains("://") || text.contains("localhost")
}

fn violations(src: &str) -> Vec<(usize, String)> {
    if src.lines().next().is_some_and(|l| l.contains(GENERATED_MARK)) {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut in_const = false;
    for (n, line) in lex(src).iter().enumerate() {
        let code = line.code.trim();
        if code.starts_with(TEST_CUTOFF) {
            break;
        }
        let starts_const = ["const ", "static ", "pub const ", "pub static ", "pub(crate) const ", "pub(crate) static "]
            .iter()
            .any(|p| code.starts_with(p));
        if starts_const {
            in_const = true;
        }
        let allowed = line.comment.split_once(ALLOW_MARK).is_some_and(|(_, why)| !why.trim().is_empty());
        if !in_const && !allowed {
            for number in bad_numbers(code) {
                out.push((n + 1, format!("number {number}")));
            }
            for (text, raw) in &line.strings {
                if is_path_or_address(text, *raw) {
                    out.push((n + 1, format!("path or address \"{text}\"")));
                }
            }
        }
        if in_const && code.ends_with(';') {
            in_const = false;
        }
    }
    out
}

fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
        let p = e.unwrap().path();
        if p.is_dir() {
            sources(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

#[test]
fn no_hardcoded_value_outside_csdm_core() {
    let root = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/.."));
    let mut files = Vec::new();
    for krate in std::fs::read_dir(root).unwrap() {
        let krate = krate.unwrap().path();
        let name = krate.file_name().unwrap().to_string_lossy().to_string();
        if krate.join("Cargo.toml").is_file() && krate.join("src").is_dir() && !EXEMPT_CRATES.contains(&name.as_str()) {
            sources(&krate.join("src"), &mut files);
        }
    }
    assert!(!files.is_empty(), "no source found under {}", root.display());
    let mut found = Vec::new();
    for f in &files {
        let src = std::fs::read_to_string(f).unwrap();
        for (line, what) in violations(&src) {
            found.push(format!("{}:{line}: {what}", f.strip_prefix(root).unwrap_or(f).display()));
        }
    }
    assert!(found.is_empty(), "hardcoded values (name them in csdm-core, or add `// allow-hardcode: <reason>`):\n{}", found.join("\n"));
}

#[test]
fn the_guard_itself() {
    let v = |s: &str| violations(s).into_iter().map(|(_, w)| w).collect::<Vec<_>>();
    assert_eq!(v("let t = 30;"), ["number 30"]);
    assert_eq!(v("let t = 0.5_f32 + 1.0 + 2usize + x.3 + 0;"), ["number 0.5_f32"]);
    assert_eq!(v("for i in 1..60 {}"), ["number 60"]);
    assert_eq!(v("let m = 0xFF + 1u8 + 2u128;"), ["number 0xFF"]);
    assert_eq!(v("let p = \"C:\\\\Users\\\\x\";"), ["path or address \"C:\\\\Users\\\\x\""]);
    assert_eq!(v("let p = r\"D:\\games\";").len(), 1);
    assert_eq!(v("let u = \"http://example.org\"; let h = \"127.0.0.1\";").len(), 2);
    assert!(v("let s = \"line\\n and/or 3 apples\";").is_empty(), "escapes, slashes and digits in prose");
    assert!(v("// wait 30 s\nlet x = 1; /* 99 */").is_empty(), "comments never count");
    assert!(v("const T: u64 = 30;\npub static U: [u32; 3] = [\n    10, 20, 30,\n];").is_empty(), "named constants");
    assert!(v("let t = 30; // allow-hardcode: protocol value").is_empty());
    assert_eq!(v("let t = 30; // allow-hardcode:").len(), 1, "a reason is required");
    assert!(v("// @generated by a tool\nlet t = 30;").is_empty());
    assert!(v("fn f<'a>(c: char) -> bool { c == 'x' || c == '\\'' }\n#[cfg(test)]\nmod tests { const _: () = (); fn t() { let _ = 99; } }").is_empty());
    assert_eq!(v("let s = \"a\"; let t = 42;"), ["number 42"], "code after a string still read");
}
