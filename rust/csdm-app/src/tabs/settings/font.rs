//! `ui_font_family` (UI Theme): the monospace font of the window (3.5 `AppShell` `--font-mono`).
//! "auto" or empty keeps the built-in fonts; a family name is looked up in the fonts Windows
//! lists (registry, machine then user), its file read and put first in the monospace family.

use crate::paint::install_fonts;
use csdm_core::ui_values::FONT_DIR;
use eframe::egui::{self, epaint, FontFamily};
use std::path::PathBuf;

const AUTO: &str = "auto";
/// `HKEY_LOCAL_MACHINE`, `HKEY_CURRENT_USER` (winreg.h).
const HKLM: isize = 0x8000_0002_u32 as i32 as isize;
const HKCU: isize = 0x8000_0001_u32 as i32 as isize;
const FONTS_KEY: &str = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const KEY_READ: u32 = 0x2_0019;
const ERROR_SUCCESS: i32 = 0;
const NAME_CHARS: usize = 512;
const DATA_BYTES: usize = 2048;
/// Registry names end with the kind, e.g. "Consolas (TrueType)".
const KIND_OPEN: char = '(';
const STYLE_REGULAR: &str = " Regular";
const COLLECTION_SEPARATOR: &str = " & ";

#[link(name = "advapi32")]
extern "system" {
    fn RegOpenKeyExW(key: isize, sub_key: *const u16, options: u32, sam: u32, result: *mut isize) -> i32;
    fn RegEnumValueW(key: isize, index: u32, name: *mut u16, name_len: *mut u32, reserved: *mut u32, kind: *mut u32, data: *mut u8, data_len: *mut u32) -> i32;
    fn RegCloseKey(key: isize) -> i32;
}

/// Every (registry name, file) of one fonts key.
fn listed(root: isize) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let sub: Vec<u16> = FONTS_KEY.encode_utf16().chain(std::iter::once(0)).collect();
    let mut key: isize = 0;
    // SAFETY: the sub-key is NUL-terminated and `key` receives the handle, closed below.
    if unsafe { RegOpenKeyExW(root, sub.as_ptr(), 0, KEY_READ, &mut key) } != ERROR_SUCCESS {
        return out;
    }
    for index in 0.. {
        let mut name = vec![0u16; NAME_CHARS];
        let mut data = vec![0u8; DATA_BYTES];
        let (mut name_len, mut data_len, mut kind) = (NAME_CHARS as u32, DATA_BYTES as u32, 0u32);
        // SAFETY: both buffers are as long as the lengths given; the call writes within them.
        let rc = unsafe { RegEnumValueW(key, index, name.as_mut_ptr(), &mut name_len, std::ptr::null_mut(), &mut kind, data.as_mut_ptr(), &mut data_len) };
        if rc != ERROR_SUCCESS {
            break;
        }
        let wide: Vec<u16> = data[..data_len as usize].as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).take_while(|c| *c != 0).collect();
        out.push((String::from_utf16_lossy(&name[..name_len as usize]), String::from_utf16_lossy(&wide)));
    }
    // SAFETY: `key` was opened above.
    unsafe { RegCloseKey(key) };
    out
}

/// Whether a registry name ("Cascadia Mono Regular (TrueType)", "A & B (TrueType)") is `family`.
pub fn names_family(listed_name: &str, family: &str) -> bool {
    let base = listed_name.split(KIND_OPEN).next().unwrap_or_default().trim();
    let want = family.trim();
    base.split(COLLECTION_SEPARATOR).any(|n| {
        let n = n.trim();
        n.eq_ignore_ascii_case(want) || n.eq_ignore_ascii_case(&format!("{want}{STYLE_REGULAR}"))
    })
}

/// The file of an installed font family, if Windows lists one.
pub fn font_file(family: &str) -> Option<PathBuf> {
    [HKLM, HKCU].into_iter().flat_map(listed).find(|(name, _)| names_family(name, family)).map(|(_, file)| {
        let p = PathBuf::from(&file);
        if p.is_absolute() { p } else { PathBuf::from(FONT_DIR).join(file) }
    })
}

/// Puts the fonts back as built, then `family` first for monospace text. `Err`: the sentence for
/// the console (the built-in font stays in use).
pub fn apply_mono(ctx: &egui::Context, family: &str) -> Result<(), String> {
    ctx.set_fonts(egui::FontDefinitions::default());
    install_fonts(ctx);
    let family = family.trim();
    if family.is_empty() || family.eq_ignore_ascii_case(AUTO) {
        return Ok(());
    }
    let missing = || format!("The font \"{family}\" is not installed: the built-in font is used. Check its name in Windows › Fonts.");
    let path = font_file(family).ok_or_else(missing)?;
    let bytes = std::fs::read(&path).map_err(|_| missing())?;
    use epaint::text::{FontData, FontInsert, FontPriority, InsertFontFamily};
    ctx.add_font(FontInsert::new(family, FontData::from_owned(bytes), vec![InsertFontFamily { family: FontFamily::Monospace, priority: FontPriority::Highest }]));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_names_match_their_family() {
        assert!(names_family("Consolas (TrueType)", "consolas"));
        assert!(names_family("Cascadia Mono Regular (TrueType)", "Cascadia Mono"));
        assert!(names_family("Cambria & Cambria Math (TrueType)", "Cambria Math"));
        assert!(!names_family("Consolas Bold (TrueType)", "Consolas"));
        assert!(!names_family("Arial (TrueType)", "Consolas"));
    }

    #[test]
    fn installed_family_is_found_and_unknown_one_is_said() {
        // Consolas ships with every Windows the app supports.
        assert!(font_file("Consolas").is_some_and(|p| p.is_file()));
        assert!(font_file("No Such Font 7f3a").is_none());
        let ctx = egui::Context::default();
        assert!(apply_mono(&ctx, "auto").is_ok());
        assert!(apply_mono(&ctx, "Consolas").is_ok());
        assert!(apply_mono(&ctx, "No Such Font 7f3a").unwrap_err().contains("not installed"));
    }
}
