# AUTO-GENERATED FILE. DO NOT EDIT!
cask "compresso@2.1.0" do
  version "2.1.0"

  on_arm do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_aarch64.dmg"
    sha256 "4e17087456d149a307dd5daf3390a7ac678dbc799fcaf77211981e74acf8f417"
  end

  on_intel do
    url "https://github.com/codeforreal1/compressO/releases/download/#{version}/CompressO_#{version}_x64.dmg"
    sha256 "7598c5268226a01419fbb70ed170beb9302f213a473d5f613bd02633713b701e"
  end

  name "CompressO"
  desc "Compress any video file to a tiny size"
  homepage "https://github.com/codeforreal1/compressO"

  depends_on macos: :ventura # macOS 13 or newer

  postflight do
    system "xattr -cr com.apple.quarantine #{appdir}/CompressO.app"
  end

  app "CompressO.app"

  zap trash: [
    "~/Library/Application Support/com.compresso.app",
    "~/Library/Caches/com.compresso.app",
    "~/Library/Preferences/com.compresso.app.plist",
    "~/Library/Saved Application State/com.compresso.app.savedState",
  ]
end
