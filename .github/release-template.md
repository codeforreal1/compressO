<div align="center">
  <div align="center">
   <img width="100" height="100" src="https://github.com/codeforreal1/compressO/blob/main/public/logo.png?raw=true" alt="Logo">
  </div>
	<h1 align="center">CompressO</h1>
  </div>
</div>
</div>

- `CompressO_{{version}}_amd64.deb`: Debian derivative of Linux like Ubuntu
- `CompressO_{{version}}_amd64.AppImage`: Universal package for all Linux distros
- `CompressO_{{version}}_aarch64.dmg` : Apple devices with Apple Silicon Chip
- `CompressO_{{version}}_x64.dmg` : Apple devices with Intel Chip
- `CompressO_{{version}}_x64.exe`: Windows build

### Upgrade
To upgrade, just download the latest build from the [website](https://compresso.codeforreal.com/#download) or GitHub releases page and install it in your platform.

### Upgrade via Homebrew (MacOS only)
If you've installed CompressO via Homebrew, then use the following command to upgrade:
```
brew upgrade --cask codeforreal1/tap/compresso
```

If you get `It seems the App source '/Applications/CompressO.app' is not there.` error:
```
brew uninstall --cask --force compresso
brew install --cask codeforreal1/tap/compresso
```

# Changelog
<details>
<summary>View full changelog</summary>

{{changelog}}

</details>
