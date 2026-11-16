//! The VIDEO tab (T10, 3.5 `tabs/VideoTab.tsx`): Final Assembly, Resolution / Framerate / Window,
//! Recording System, HLAE Options (HLAE mode only), In-Game Options, CS2 Effects, Encoding.
//! Each card is drawn in the `timeline` style (the default card style); T12 adds the other two.
//!
//! Every control writes one setting through `Link`; the only engine question is `describe_filters`,
//! for the tables the cards offer (resolutions, frame rates, codecs: never copied here).

mod cards;
pub mod kit;

use crate::grid::{CardCx, CardDecl, TabView};
use csdm_engine::batch::cli_json::normalize_recsys;
use csdm_engine::Command;
use serde_json::Value;

/// The tables of `describe_filters` the cards offer (3.5 `useTables`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tables {
    /// Label, width, height.
    pub resolutions: Vec<(String, i64, i64)>,
    pub framerates: Vec<i64>,
    pub video_codecs: Vec<String>,
    pub audio_codecs: Vec<String>,
}

impl Tables {
    fn from_reply(v: &Value) -> Self {
        let d = &v["data"];
        let words = |k: &str| d[k].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
        Self {
            resolutions: d["resolutions"].as_array().into_iter().flatten()
                .filter_map(|r| Some((r["label"].as_str()?.to_string(), r["width"].as_i64()?, r["height"].as_i64()?)))
                .collect(),
            framerates: d["framerates"].as_array().into_iter().flatten().filter_map(Value::as_i64).collect(),
            video_codecs: words("video_codecs"),
            audio_codecs: words("audio_codecs"),
        }
    }
}

pub struct VideoTab {
    asked: Option<u64>,
    /// Read from the settings at the last card drawn: `cards()` has no settings (HLAE card, counts).
    seen: cards::Header,
    /// `None` until the engine answers.
    pub tables: Option<Tables>,
    /// Why the tables did not come (said in the cards that need them).
    pub tables_error: Option<String>,
}

impl Default for VideoTab {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoTab {
    pub fn new() -> Self {
        Self { asked: None, seen: cards::Header::default(), tables: None, tables_error: None }
    }

    fn tables_in(&mut self, cx: &mut CardCx) {
        if self.tables.is_some() || self.tables_error.is_some() {
            return;
        }
        match self.asked {
            None => self.asked = Some(cx.link.request(cx.now, Command::DescribeFilters)),
            Some(id) => match cx.link.take_reply(id) {
                Some(Ok(v)) => self.tables = Some(Tables::from_reply(&v)),
                Some(Err(e)) => self.tables_error = Some(e),
                None => {}
            },
        }
    }
}

/// The engine records through HLAE unless the setting says "CS" (3.5 `_normalize_recsys`): the HLAE
/// card shows exactly when its options are used.
pub fn is_hlae(link: &crate::link::Link) -> bool {
    normalize_recsys(link.get("recsys").unwrap_or(&Value::Null)) == csdm_core::batch::RECSYS_HLAE
}

impl TabView for VideoTab {
    fn cards(&self) -> Vec<CardDecl> {
        cards::decls(&self.seen)
    }

    fn body(&mut self, id: &str, ui: &mut eframe::egui::Ui, cx: &mut CardCx) {
        self.tables_in(cx);
        self.seen = cards::Header::read(cx.link);
        match id {
            "final-assembly" => cards::final_assembly(ui, cx),
            "resolution" => cards::resolution(self, ui, cx),
            "recording-system" => cards::recording_system(ui, cx),
            "hlae-options" => cards::hlae_options(ui, cx),
            "in-game-options" => cards::in_game_options(ui, cx),
            "cs2-effects" => cards::cs2_effects(ui, cx),
            "encoding" => cards::encoding(self, ui, cx),
            _ => {}
        }
    }

    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }
}
