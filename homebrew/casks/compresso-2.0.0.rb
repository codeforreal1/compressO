# AUTO-GENERATED FILE. DO NOT EDIT!
cask "compresso@2.0.0" do
  version "2.0.0"

  on_arm do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_aarch64.dmg"
    sha256 "1d3c700a16963534b9c1b5bfaa08ee2fb5729720dcea2772ba23210d4cbd445e"
  end

  on_intel do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_x64.dmg"
    sha256 "306dd6dce3b62c4736558acb5c2e4e3b901c6c39f78e7f08080cee8f85f441b1"
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
