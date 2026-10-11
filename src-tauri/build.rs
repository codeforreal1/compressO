#[cfg(target_os = "macos")]
use std::{path::PathBuf, process::Command};

fn main() {
    #[cfg(target_os = "macos")]
    build_swift_library();

    tauri_build::build()
}

// Compiles the Swift package (native macOS UI) into a static library and links it in. Rust talks to
// it through the `swift-bridge` FFI declared in `src/macos/bridge.rs`.
#[cfg(target_os = "macos")]
fn build_swift_library() {
    println!("cargo:rerun-if-changed=swift-library/Sources/swift-library");
    println!("cargo:rerun-if-changed=swift-library/Package.swift");
    println!("cargo:rerun-if-changed=src/macos/bridge.rs");

    let bridge_files = vec!["src/macos/bridge.rs"];
    swift_bridge_build::parse_bridges(bridge_files)
        .write_all_concatenated(generated_code_dir(), "rust-calls-swift");

    compile_swift();

    let swift_lib_dir = swift_library_static_lib_dir();
    let swift_lib_path = swift_lib_dir.join("libswift-library.a");
    println!(
        "cargo:rustc-link-arg=-Wl,-force_load,{}",
        swift_lib_path.to_str().unwrap()
    );
    println!(
        "cargo:rustc-link-search={}",
        swift_lib_dir.to_str().unwrap()
    );

    let xcode_path = Command::new("xcode-select")
        .arg("--print-path")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|path| path.trim().to_string())
        .unwrap_or_else(|| "/Applications/Xcode.app/Contents/Developer".to_string());
    println!(
        "cargo:rustc-link-search={}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx/",
        &xcode_path
    );
    println!("cargo:rustc-link-search=/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!(
        "cargo:rustc-link-arg=-Wl,-rpath,{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
        &xcode_path
    );
}

#[cfg(target_os = "macos")]
fn compile_swift() {
    let mut cmd = swift_build_command();
    cmd.args([
        "-Xswiftc",
        "-import-objc-header",
        "-Xswiftc",
        swift_source_dir()
            .join("bridging-header.h")
            .to_str()
            .unwrap(),
    ]);

    match cmd.output() {
        Ok(output) => {
            if !output.status.success() {
                panic!(
                    "\nSwift compilation failed\n\nStdout:\n{}\n\nStderr:\n{}\n",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
        Err(e) => {
            panic!("Failed to execute 'swift build' command: {}", e);
        }
    }
}

// `swift build` for the Rust target's architecture, so cross-arch builds (e.g.
// `--target x86_64-apple-darwin` on Apple silicon) link a matching library
#[cfg(target_os = "macos")]
fn swift_build_command() -> Command {
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64".to_string(),
        arch => arch.to_string(),
    };

    let mut cmd = Command::new("swift");
    cmd.current_dir(manifest_dir().join("swift-library"))
        .args(["build", "--build-system", "native"])
        .args(["--triple", &format!("{}-apple-macosx", arch)]);
    if is_release_build() {
        cmd.args(["-c", "release"]);
    }
    cmd
}

#[cfg(target_os = "macos")]
fn swift_library_static_lib_dir() -> PathBuf {
    let output = swift_build_command()
        .arg("--show-bin-path")
        .output()
        .expect("failed to run swift build --show-bin-path");
    PathBuf::from(
        String::from_utf8(output.stdout)
            .expect("non-utf8 output")
            .trim(),
    )
}

#[cfg(target_os = "macos")]
fn manifest_dir() -> PathBuf {
    PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
}

#[cfg(target_os = "macos")]
fn is_release_build() -> bool {
    std::env::var("PROFILE").unwrap() == "release"
}

#[cfg(target_os = "macos")]
fn swift_source_dir() -> PathBuf {
    manifest_dir().join("swift-library/Sources/swift-library")
}

#[cfg(target_os = "macos")]
fn generated_code_dir() -> PathBuf {
    swift_source_dir().join("generated")
}
