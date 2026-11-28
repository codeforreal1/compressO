#![allow(unexpected_cfgs)]

//! Asks for confirmation before quitting (or closing the main window) while media is being
//! compressed or compressed media is not saved yet, since both would be lost.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::tauri_commands::compression_status::{has_unsaved_output, is_compressing};

fn is_main_window_visible(app_handle: &AppHandle) -> bool {
    app_handle
        .get_webview_window(crate::tauri_commands::window::MAIN_WINDOW_LABEL)
        .is_some_and(|window| {
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
        })
}

fn unsaved_cancel_label(texts: &super::native_text::NativeTexts, is_main_visible: bool) -> String {
    if is_main_visible {
        texts.go_back.clone()
    } else {
        texts.open_main_app.clone()
    }
}

/// Whether media of the drop zone's queue is waiting or being compressed
fn is_drop_queue_active(app_handle: &AppHandle) -> bool {
    crate::tauri_commands::drop_queue::is_queue_active(app_handle)
}

/// Set once quitting was confirmed, so the quit that follows isn't asked about again
static IS_QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
/// Only one confirmation is shown at a time (e.g. ⌘Q pressed twice)
static IS_CONFIRMATION_OPEN: AtomicBool = AtomicBool::new(false);

/// Why quitting needs a confirmation
#[derive(Clone, Copy)]
pub enum QuitReason {
    /// Quitting cancels the compression
    Compressing,
    /// Quitting discards compressed outputs that are not saved yet
    UnsavedOutput,
    /// Quitting stops compressing the drop zone's queue
    DropQueue,
}

/// When closing the main window, returns the confirmation reason that must keep the window open
/// instead of closing it: only when nothing keeps the app alive in the background and quitting
/// would discard active or unsaved work.
pub fn main_window_close_reason(
    is_session_compressing: bool,
    keep_running_without_main: bool,
    reason: Option<QuitReason>,
) -> Option<QuitReason> {
    if is_session_compressing || keep_running_without_main {
        return None;
    }
    reason
}

/// Why quitting needs a confirmation first, if it does
pub fn quit_reason(app_handle: &AppHandle) -> Option<QuitReason> {
    if IS_QUIT_CONFIRMED.load(Ordering::SeqCst) {
        None
    } else if is_compressing(app_handle) || crate::core::session::is_session_compressing() {
        Some(QuitReason::Compressing)
    } else if has_unsaved_output(app_handle) || crate::core::session::has_session_unsaved_output() {
        Some(QuitReason::UnsavedOutput)
    } else if is_drop_queue_active(app_handle) {
        Some(QuitReason::DropQueue)
    } else {
        None
    }
}

/// Asks whether to quit anyway; `on_confirm` runs if the user chooses to quit
pub fn confirm_quit(
    app_handle: &AppHandle,
    reason: QuitReason,
    on_confirm: impl FnOnce() + Send + 'static,
) {
    if IS_CONFIRMATION_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }

    let texts = super::native_text::get();
    let should_open_app_on_cancel =
        matches!(reason, QuitReason::UnsavedOutput) && !is_main_window_visible(app_handle);
    let (title, message, cancel_label) = match reason {
        QuitReason::Compressing => (
            texts.compressing_title,
            texts.compressing_message,
            texts.continue_compressing,
        ),
        QuitReason::UnsavedOutput => {
            let label = unsaved_cancel_label(&texts, !should_open_app_on_cancel);
            (texts.unsaved_title, texts.unsaved_message, label)
        }
        QuitReason::DropQueue => (
            texts.compressing_title,
            texts.drop_queue_message,
            texts.continue_compressing,
        ),
    };

    let cancel_app_handle = app_handle.clone();
    app_handle
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(texts.quit, cancel_label))
        .show(move |is_confirmed| {
            IS_CONFIRMATION_OPEN.store(false, Ordering::SeqCst);
            if is_confirmed {
                IS_QUIT_CONFIRMED.store(true, Ordering::SeqCst);
                on_confirm();
            } else if should_open_app_on_cancel {
                if let Err(err) =
                    crate::tauri_commands::window::focus_or_create_main_window(&cancel_app_handle)
                {
                    log::error!("Failed to open the main window: {}", err);
                }
            }
        });
}

/// ⌘Q, the app menu's Quit & the Dock's Quit end the app without any event Tauri can prevent (the
/// app delegate has no `applicationShouldTerminate:`), so it is added to the delegate here.
#[cfg(target_os = "macos")]
pub fn install_macos_quit_confirmation(app_handle: &AppHandle) {
    use objc::runtime::{class_addMethod, object_getClass, Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::OnceLock;

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    let _ = APP_HANDLE.set(app_handle.clone());

    const NS_TERMINATE_CANCEL: usize = 0;
    const NS_TERMINATE_NOW: usize = 1;

    extern "C" fn application_should_terminate(_: &Object, _: Sel, _: *mut Object) -> usize {
        let Some(app_handle) = APP_HANDLE.get() else {
            return NS_TERMINATE_NOW;
        };
        let Some(reason) = quit_reason(app_handle) else {
            return NS_TERMINATE_NOW;
        };
        let exit_app_handle = app_handle.clone();
        confirm_quit(app_handle, reason, move || exit_app_handle.exit(0));
        NS_TERMINATE_CANCEL
    }

    unsafe {
        let ns_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut Object = msg_send![ns_app, delegate];
        if delegate.is_null() {
            log::error!("Quit confirmation unavailable: the app delegate is not set");
            return;
        }
        let delegate_class = object_getClass(delegate) as *mut _;
        let implementation: extern "C" fn(&Object, Sel, *mut Object) -> usize =
            application_should_terminate;
        // Returns an NSUInteger (`Q`), takes self, _cmd & the NSApplication (`@:@`)
        let is_added = class_addMethod(
            delegate_class,
            sel!(applicationShouldTerminate:),
            std::mem::transmute(implementation),
            c"Q@:@".as_ptr(),
        );
        // `BOOL` is a `bool` on Apple Silicon but an `i8` on Intel Macs, so compared with `NO`
        if is_added == objc::runtime::NO {
            log::error!(
                "Quit confirmation unavailable: applicationShouldTerminate: already exists"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{main_window_close_reason, unsaved_cancel_label, QuitReason};
    use crate::sys::native_text::NativeTexts;

    #[test]
    fn unsaved_quit_cancel_label_adapts_to_main_window_visibility() {
        let texts = NativeTexts::default();
        assert_eq!(unsaved_cancel_label(&texts, true), "Go Back");
        assert_eq!(unsaved_cancel_label(&texts, false), "Open App");
    }

    #[test]
    fn main_window_close_detaches_while_compressing_and_prompts_when_unsaved() {
        assert!(main_window_close_reason(true, false, Some(QuitReason::UnsavedOutput)).is_none());
        assert!(main_window_close_reason(false, true, Some(QuitReason::UnsavedOutput)).is_none());
        assert!(main_window_close_reason(false, false, None).is_none());
        assert!(matches!(
            main_window_close_reason(false, false, Some(QuitReason::UnsavedOutput)),
            Some(QuitReason::UnsavedOutput)
        ));
    }
}
