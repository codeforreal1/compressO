import Foundation
import ServiceManagement

/// State of the login item (a launch agent, see `tauri_plugin_autostart`) in macOS's background
/// items (System Settings > General > Login Items), which can switch it off while its file is kept:
/// 1 allowed, 2 switched off ("Allow in the Background" off), 0 not registered, -1 unknown (not
/// found, or before macOS 13, which has no such switch)
func loginItemStatus(plistPath: RustString) -> Int32 {
    guard #available(macOS 13.0, *) else { return -1 }
    let url = URL(fileURLWithPath: plistPath.toString())
    switch SMAppService.statusForLegacyPlist(at: url) {
    case .enabled:
        return 1
    case .requiresApproval:
        return 2
    case .notRegistered:
        return 0
    default:
        return -1
    }
}
