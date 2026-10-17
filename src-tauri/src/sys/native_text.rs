//! Text of the native interface (the app menu, the tray icon's menu, the quit confirmation) in the
//! app's language. The frontend has the translations (see `src/i18n`) & sends them when it starts
//! and when the language changes; English until then.

use std::sync::RwLock;

#[derive(Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NativeTexts {
    // The quit confirmation (see `quit::confirm_quit`)
    pub quit: String,
    pub continue_compressing: String,
    pub go_back: String,
    pub compressing_title: String,
    pub compressing_message: String,
    pub unsaved_title: String,
    pub unsaved_message: String,
    pub drop_queue_message: String,
    // The tray icon's menu
    pub open_app: String,
    pub quit_app: String,
    // The app menu (macOS)
    pub about_app: String,
    pub settings: String,
    pub services: String,
    pub hide_app: String,
    pub hide_others: String,
    pub file: String,
    pub close_window: String,
    pub edit: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub copy: String,
    pub paste: String,
    pub select_all: String,
    pub view: String,
    pub full_screen: String,
    pub window: String,
    pub minimize: String,
    pub zoom: String,
    pub help: String,
}

impl Default for NativeTexts {
    fn default() -> Self {
        let text = |value: &str| value.to_string();
        Self {
            quit: text("Quit"),
            continue_compressing: text("Continue Compressing"),
            go_back: text("Go Back"),
            compressing_title: text("Compression in progress"),
            compressing_message: text(
                "Media is still being compressed. Quitting now will cancel the compression.",
            ),
            unsaved_title: text("Media not saved"),
            unsaved_message: text(
                "Your compressed media is not saved yet. Quitting now will discard it.",
            ),
            drop_queue_message: text(
                "Media in the drop zone is still being compressed. Quitting now will stop it.",
            ),
            open_app: text("Open CompressO"),
            quit_app: text("Quit CompressO"),
            about_app: text("About CompressO"),
            settings: text("Settings…"),
            services: text("Services"),
            hide_app: text("Hide CompressO"),
            hide_others: text("Hide Others"),
            file: text("File"),
            close_window: text("Close Window"),
            edit: text("Edit"),
            undo: text("Undo"),
            redo: text("Redo"),
            cut: text("Cut"),
            copy: text("Copy"),
            paste: text("Paste"),
            select_all: text("Select All"),
            view: text("View"),
            full_screen: text("Toggle Full Screen"),
            window: text("Window"),
            minimize: text("Minimize"),
            zoom: text("Zoom"),
            help: text("Help"),
        }
    }
}

static TEXTS: RwLock<Option<NativeTexts>> = RwLock::new(None);

/// The texts in the app's language (English until the frontend sends them)
pub fn get() -> NativeTexts {
    TEXTS
        .read()
        .ok()
        .and_then(|texts| texts.clone())
        .unwrap_or_default()
}

/// Keeps the texts; whether they changed (so the menus are only rebuilt when needed)
pub fn set(texts: NativeTexts) -> bool {
    let Ok(mut current) = TEXTS.write() else {
        return false;
    };
    if current.as_ref() == Some(&texts) {
        return false;
    }
    *current = Some(texts);
    true
}
