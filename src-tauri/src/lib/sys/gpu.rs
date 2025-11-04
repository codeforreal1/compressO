use wgpu::{Backends, Instance};

pub enum GpuType {
    Nvidia,
    Amd,
}

/// Detect GPU(if available) on the system.
pub fn detect_gpu() -> Option<GpuType> {
    let instance = Instance::default();
    let adapters = instance.enumerate_adapters(Backends::all());

    for adapter in adapters {
        let info = adapter.get_info();

        let gpu = match info.vendor {
            0x10DE => Some(GpuType::Nvidia),
            0x1002 | 0x1022 => Some(GpuType::Amd),
            _ => None,
        };
        if gpu.is_some() {
            return gpu;
        }
    }
    None
}
