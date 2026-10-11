#![allow(unexpected_cfgs)]

//! Asks for confirmation before quitting (or closing the main window) while media is being
//! compressed, since that cancels the compression.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::tauri_commands::compression_status::is_compressing;

/// Set once quitting was confirmed, so the quit that follows isn't asked about again
static IS_QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
/// Only one confirmation is shown at a time (e.g. ⌘Q pressed twice)
static IS_CONFIRMATION_OPEN: AtomicBool = AtomicBool::new(false);

/// Whether quitting needs a confirmation first
pub fn should_confirm_quit(app_handle: &AppHandle) -> bool {
    !IS_QUIT_CONFIRMED.load(Ordering::SeqCst) && is_compressing(app_handle)
}

/// Asks whether to quit during the compression; `on_confirm` runs if the user chooses to quit
pub fn confirm_quit(app_handle: &AppHandle, on_confirm: impl FnOnce() + Send + 'static) {
    if IS_CONFIRMATION_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }

    app_handle
        .dialog()
        .message("Media is still being compressed. Quitting now will cancel the compression.")
        .title("Compression in progress")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".to_string(),
            "Continue Compressing".to_string(),
        ))
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
        if !should_confirm_quit(app_handle) {
            return NS_TERMINATE_NOW;
        }
        let exit_app_handle = app_handle.clone();
        confirm_quit(app_handle, move || exit_app_handle.exit(0));
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
        if !is_added {
            log::error!(
                "Quit confirmation unavailable: applicationShouldTerminate: already exists"
            );
        }
    }
}
