# AUTO-GENERATED FILE. DO NOT EDIT!
cask "compresso@2.1.1" do
  version "2.1.1"

  on_arm do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_aarch64.dmg"
    sha256 "8e87b4e8bcf783662f7f501fbc1bd13c74d8e14e4fd7005a8bbeea0fc4c2ceeb"
  end

  on_intel do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_x64.dmg"
    sha256 "b6132991f9fd17241c38ed71fb71444e1278d2890f827c356a24376d73adfbb6"
  end

  name "CompressO"
  desc "Compress any video file to a tiny size"
  homepage "https://github.com/codeforreal1/compressO"

  depends_on macos: :ventura # macOS 13 or newer

  # Clears the quarantine flag macOS adds to downloaded apps
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-cr", "{{appdir}}/CompressO.app"],
        must_succeed:   false,
        writable_paths: ["CompressO.app"],
        writable_base:  :appdir
  end

  app "CompressO.app"

  zap trash: [
    "~/Library/Application Support/com.compresso.app",
    "~/Library/Caches/com.compresso.app",
    "~/Library/Preferences/com.compresso.app.plist",
    "~/Library/Saved Application State/com.compresso.app.savedState",
  ]
end
