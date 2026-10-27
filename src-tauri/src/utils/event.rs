use tauri::{AppHandle, EventId, Listener, Runtime, WebviewWindow};

enum ListenerTarget<R: Runtime> {
    Window(WebviewWindow<R>),
    App(AppHandle<R>),
}

/// Removes an event listener when dropped. Tauri keeps listeners (& what they capture) even after a
/// window is closed, so short-lived listeners must be removed explicitly.
pub struct EventListenerGuard<R: Runtime> {
    target: ListenerTarget<R>,
    event_id: EventId,
}

impl<R: Runtime> EventListenerGuard<R> {
    /// For a listener of a window's events
    pub fn new(window: WebviewWindow<R>, event_id: EventId) -> Self {
        Self {
            target: ListenerTarget::Window(window),
            event_id,
        }
    }

    /// For a listener of the events of the whole app (from any window)
    pub fn for_app(app: AppHandle<R>, event_id: EventId) -> Self {
        Self {
            target: ListenerTarget::App(app),
            event_id,
        }
    }
}

impl<R: Runtime> Drop for EventListenerGuard<R> {
    fn drop(&mut self) {
        match &self.target {
            ListenerTarget::Window(window) => window.unlisten(self.event_id),
            ListenerTarget::App(app) => app.unlisten(self.event_id),
        }
    }
}
