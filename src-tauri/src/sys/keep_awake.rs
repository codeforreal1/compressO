//! Keeps the computer from going to sleep while media is compressed (Settings -> General), so a long
//! batch is not paused when the computer is left alone. Only idle sleep is prevented: closing the
//! lid or choosing Sleep still sleeps the computer.
//!
//! - macOS: IOKit power assertions (`pmset -g assertions` lists them)
//! - Windows: power requests (`powercfg /requests` lists them)
//! - Linux: a systemd-logind idle inhibitor, and the screensaver's inhibitor to keep the screen on
//!   (`systemd-inhibit --list` lists the first); desktops without them are left as they are

use std::sync::atomic::{AtomicBool, Ordering};

/// "Prevent sleep while compressing" (on by default)
static IS_ENABLED: AtomicBool = AtomicBool::new(true);
/// "Keep the screen on" (off by default): the screen can turn off while the computer stays awake
static SHOULD_KEEP_DISPLAY_ON: AtomicBool = AtomicBool::new(false);

const REASON: &str = "Compressing media";

/// Sets what is kept awake by the compressions started from now on
pub fn set_settings(is_enabled: bool, should_keep_display_on: bool) {
    IS_ENABLED.store(is_enabled, Ordering::SeqCst);
    SHOULD_KEEP_DISPLAY_ON.store(should_keep_display_on, Ordering::SeqCst);
}

/// Held while compressing: the computer can sleep again once it is dropped (also when the
/// compression fails or is cancelled)
pub struct KeepAwake {
    _assertion: Option<platform::Assertion>,
}

impl KeepAwake {
    pub fn acquire() -> Self {
        let assertion = if IS_ENABLED.load(Ordering::SeqCst) {
            platform::Assertion::new(SHOULD_KEEP_DISPLAY_ON.load(Ordering::SeqCst))
                .map_err(|err| log::error!("[keep awake] Could not keep the computer awake: {}", err))
                .ok()
        } else {
            None
        };
        Self {
            _assertion: assertion,
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            level: u32,
            name: CFStringRef,
            assertion_id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }

    const ASSERTION_LEVEL_ON: u32 = 255;
    const RETURN_SUCCESS: i32 = 0;

    pub struct Assertion {
        ids: Vec<u32>,
    }

    impl Assertion {
        pub fn new(should_keep_display_on: bool) -> Result<Self, String> {
            let mut types = vec!["PreventUserIdleSystemSleep"];
            if should_keep_display_on {
                types.push("PreventUserIdleDisplaySleep");
            }
            let name = CFString::new(super::REASON);
            let mut ids = Vec::new();
            for assertion_type in types {
                let assertion_type = CFString::new(assertion_type);
                let mut id = 0u32;
                let result = unsafe {
                    IOPMAssertionCreateWithName(
                        assertion_type.as_concrete_TypeRef(),
                        ASSERTION_LEVEL_ON,
                        name.as_concrete_TypeRef(),
                        &mut id,
                    )
                };
                if result != RETURN_SUCCESS {
                    // The ones created are released with it
                    drop(Self { ids });
                    return Err(format!("IOPMAssertionCreateWithName failed ({})", result));
                }
                ids.push(id);
            }
            Ok(Self { ids })
        }
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            for id in &self.ids {
                unsafe { IOPMAssertionRelease(*id) };
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Power::{
        PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired,
        PowerRequestSystemRequired, PowerSetRequest, POWER_REQUEST_TYPE,
    };
    use windows_sys::Win32::System::SystemServices::POWER_REQUEST_CONTEXT_VERSION;
    use windows_sys::Win32::System::Threading::{
        POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
    };

    /// A power request, which (unlike `SetThreadExecutionState`) is not tied to the thread that made
    /// it, so it can be released from any thread
    pub struct Assertion {
        handle: HANDLE,
        request_types: Vec<POWER_REQUEST_TYPE>,
    }

    // The handle is only used to clear & close the request, which any thread can do
    unsafe impl Send for Assertion {}
    unsafe impl Sync for Assertion {}

    impl Assertion {
        pub fn new(should_keep_display_on: bool) -> Result<Self, String> {
            // Shown by `powercfg /requests`
            let mut reason: Vec<u16> = super::REASON
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let context = REASON_CONTEXT {
                Version: POWER_REQUEST_CONTEXT_VERSION,
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 {
                    SimpleReasonString: reason.as_mut_ptr(),
                },
            };
            let handle = unsafe { PowerCreateRequest(&context) };
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                return Err(String::from("PowerCreateRequest failed"));
            }
            let mut assertion = Self {
                handle,
                request_types: Vec::new(),
            };
            let mut request_types = vec![PowerRequestSystemRequired];
            if should_keep_display_on {
                request_types.push(PowerRequestDisplayRequired);
            }
            for request_type in request_types {
                if unsafe { PowerSetRequest(handle, request_type) } == 0 {
                    return Err(String::from("PowerSetRequest failed"));
                }
                assertion.request_types.push(request_type);
            }
            Ok(assertion)
        }
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            unsafe {
                for request_type in &self.request_types {
                    PowerClearRequest(self.handle, *request_type);
                }
                CloseHandle(self.handle);
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use dbus::arg::OwnedFd;
    use dbus::blocking::Connection;
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_secs(2);

    pub struct Assertion {
        /// Holds systemd-logind's inhibitor until it is closed
        _idle_inhibitor: Option<OwnedFd>,
        /// The screensaver's inhibitor ends with the connection, so it is kept with its cookie
        screensaver_inhibitor: Option<(Connection, u32)>,
    }

    impl Assertion {
        pub fn new(should_keep_display_on: bool) -> Result<Self, String> {
            let idle_inhibitor = inhibit_idle()
                .map_err(|err| log::warn!("[keep awake] No logind idle inhibitor: {}", err))
                .ok();
            let screensaver_inhibitor = if should_keep_display_on {
                inhibit_screensaver()
                    .map_err(|err| log::warn!("[keep awake] No screensaver inhibitor: {}", err))
                    .ok()
            } else {
                None
            };
            if idle_inhibitor.is_none() && screensaver_inhibitor.is_none() {
                return Err(String::from("no inhibitor is available on this desktop"));
            }
            Ok(Self {
                _idle_inhibitor: idle_inhibitor,
                screensaver_inhibitor,
            })
        }
    }

    /// Prevents the system from sleeping when it is idle, until the returned descriptor is closed
    fn inhibit_idle() -> Result<OwnedFd, dbus::Error> {
        let connection = Connection::new_system()?;
        let proxy = connection.with_proxy(
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            TIMEOUT,
        );
        let (fd,): (OwnedFd,) = proxy.method_call(
            "org.freedesktop.login1.Manager",
            "Inhibit",
            ("idle", "CompressO", super::REASON, "block"),
        )?;
        Ok(fd)
    }

    /// Keeps the screen on (no screensaver or blanking), until uninhibited or disconnected
    fn inhibit_screensaver() -> Result<(Connection, u32), dbus::Error> {
        let connection = Connection::new_session()?;
        let (cookie,): (u32,) = connection
            .with_proxy(
                "org.freedesktop.ScreenSaver",
                "/org/freedesktop/ScreenSaver",
                TIMEOUT,
            )
            .method_call(
                "org.freedesktop.ScreenSaver",
                "Inhibit",
                ("CompressO", super::REASON),
            )?;
        Ok((connection, cookie))
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            if let Some((connection, cookie)) = &self.screensaver_inhibitor {
                let _: Result<(), dbus::Error> = connection
                    .with_proxy(
                        "org.freedesktop.ScreenSaver",
                        "/org/freedesktop/ScreenSaver",
                        TIMEOUT,
                    )
                    .method_call("org.freedesktop.ScreenSaver", "UnInhibit", (*cookie,));
            }
        }
    }
}
