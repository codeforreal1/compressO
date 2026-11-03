// The command line reports the app's version (`tauri.conf.json`), as it ships with the app
fn main() {
    println!("cargo:rerun-if-changed=../tauri.conf.json");
    let config = std::fs::read_to_string("../tauri.conf.json").expect("read tauri.conf.json");
    let config: serde_json::Value = serde_json::from_str(&config).expect("parse tauri.conf.json");
    let version = config["version"]
        .as_str()
        .expect("version in tauri.conf.json");
    println!("cargo:rustc-env=COMPRESSO_VERSION={version}");
}
