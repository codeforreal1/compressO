#![allow(unexpected_cfgs)]

//! Asks for confirmation before quitting (or closing the main window) while media is being
//! compressed or compressed media is not saved yet, since both would be lost.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::tauri_commands::compression_status::{has_unsaved_output, is_compressing};

/// Whether media of the drop zone's queue (macOS) is waiting or being compressed
fn is_drop_queue_active(app_handle: &AppHandle) -> bool {
    #[cfg(any(target_os = "macos", windows))]
    return crate::tauri_commands::drop_queue::is_queue_active(app_handle);
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = app_handle;
        false
    }
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

/// Why quitting needs a confirmation first, if it does
pub fn quit_reason(app_handle: &AppHandle) -> Option<QuitReason> {
    if IS_QUIT_CONFIRMED.load(Ordering::SeqCst) {
        None
    } else if is_compressing(app_handle) {
        Some(QuitReason::Compressing)
    } else if has_unsaved_output(app_handle) {
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
    let (title, message, cancel_label) = match reason {
        QuitReason::Compressing => (
            texts.compressing_title,
            texts.compressing_message,
            texts.continue_compressing,
        ),
        QuitReason::UnsavedOutput => (texts.unsaved_title, texts.unsaved_message, texts.go_back),
        QuitReason::DropQueue => (
            texts.compressing_title,
            texts.drop_queue_message,
            texts.continue_compressing,
        ),
    };

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
