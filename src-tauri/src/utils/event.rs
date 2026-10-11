use tauri::{EventId, Listener, Runtime, WebviewWindow};

/// Removes an event listener when dropped. Tauri keeps a window's listeners (& what they capture)
/// even after the window is closed, so short-lived listeners must be removed explicitly.
pub struct EventListenerGuard<R: Runtime> {
    window: WebviewWindow<R>,
    event_id: EventId,
}

impl<R: Runtime> EventListenerGuard<R> {
    pub fn new(window: WebviewWindow<R>, event_id: EventId) -> Self {
        Self { window, event_id }
    }
}

impl<R: Runtime> Drop for EventListenerGuard<R> {
    fn drop(&mut self) {
        self.window.unlisten(self.event_id);
    }
}
