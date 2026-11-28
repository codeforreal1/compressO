use std::sync::atomic::{AtomicUsize, Ordering};

/// The number of CPU threads FFmpeg may use, or `0` for all of them
static CPU_THREAD_LIMIT: AtomicUsize = AtomicUsize::new(0);

/// The CPU threads available to the app (logical processors, as FFmpeg counts them)
pub fn available_cpu_threads() -> usize {
    std::thread::available_parallelism()
        .map(|threads| threads.get())
        .unwrap_or(1)
}

/// Limits FFmpeg's CPU encoding threads; `0` uses all available threads. A limit above what this
/// computer has is brought back to its thread count.
pub fn set_thread_limit(limit: usize) {
    CPU_THREAD_LIMIT.store(
        clamp_thread_limit(limit, available_cpu_threads()),
        Ordering::SeqCst,
    );
}

/// The CPU thread limit to apply (`None` uses all available threads)
pub fn thread_limit() -> Option<usize> {
    match CPU_THREAD_LIMIT.load(Ordering::SeqCst) {
        0 => None,
        limit => Some(limit.min(available_cpu_threads())),
    }
}

/// Maximum concurrent image compressions in batch and background queues.
pub fn image_lane_concurrency() -> usize {
    thread_limit().unwrap_or_else(available_cpu_threads).clamp(1, 4)
}

/// Resolves an optional per-job CPU thread override against the global limit:
/// `None` follows `thread_limit()`, `Some(0)` uses all available threads, and `Some(n)` clamps to
/// the available hardware threads.
pub fn resolve_thread_limit(override_limit: Option<usize>) -> Option<usize> {
    match override_limit {
        None => thread_limit(),
        Some(0) => None,
        Some(limit) => Some(clamp_thread_limit(limit, available_cpu_threads())),
    }
}

/// `0` keeps all threads, and a limit is never above the available thread count
fn clamp_thread_limit(limit: usize, available: usize) -> usize {
    if limit == 0 {
        0
    } else {
        limit.min(available.max(1))
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_thread_limit, resolve_thread_limit, set_thread_limit};

    #[test]
    fn zero_keeps_all_threads() {
        assert_eq!(clamp_thread_limit(0, 8), 0);
    }

    #[test]
    fn limits_are_brought_back_to_available_threads() {
        assert_eq!(clamp_thread_limit(4, 8), 4);
        assert_eq!(clamp_thread_limit(16, 8), 8);
        assert_eq!(clamp_thread_limit(1, 0), 1);
    }

    #[test]
    fn per_job_override_precedes_global_limit() {
        set_thread_limit(2);
        assert_eq!(resolve_thread_limit(None), Some(2.min(super::available_cpu_threads())));
        assert_eq!(resolve_thread_limit(Some(0)), None);
        assert_eq!(resolve_thread_limit(Some(1)), Some(1));
        set_thread_limit(0);
    }
}
