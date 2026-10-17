# AUTO-GENERATED FILE. DO NOT EDIT!
cask "compresso@3.0.0" do
  version "3.0.0"

  on_arm do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_aarch64.dmg"
    sha256 "5fe9e0b55d291328b13b867c817dd9339078f724339f01e57484972f4c088c3a"
  end

  on_intel do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_x64.dmg"
    sha256 "58c586817e38614bb7cf01ae13acb69ca60bb682156da8b99447165c2c6d3090"
  end

  name "CompressO"
  desc "Compress any video/image into a tiny size"
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
