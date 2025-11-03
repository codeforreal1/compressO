<div align="center">
  <div align="center">
   <img width="100" height="100" src="public/logo.png" alt="Logo" />
  </div>
	<h1 align="center">CompressO</h1>
	<p align="center">
		Compress any video into a tiny size.
    </p>
    <i align="center">
		CompressO (🔉 pronounced like "Espresso" ) is a free and open-sourced cross-platform video compression app powered by FFmpeg.
    </i>
    <br />
    <p align="center">
		Available for <strong>Linux</strong>, <strong>Windows</strong> & <strong>MacOS</strong>.
    </p>
    <p>
      <strong>Download 📦</strong>
    </p>
    <div>
      <a href="https://github.com/codeforreal1/compressO/releases">
        <img alt="Linux" src="https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux&logoColor=black&color=orange" />
      </a>
      <a href="https://github.com/codeforreal1/compressO/releases">
        <img alt="Windows" src="https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows&logoColor=white" />
      </a>
      <a href="https://github.com/codeforreal1/compressO/releases">
        <img alt="macOS" src="https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple&logoColor=white" />
      </a>
    </div>
    <br />
</div>
<div align="center">
    <img src="public/screenshot.png" alt="Screenshot" height="500" style="border-radius: 16px;" />
</div>

### Tech ⌨

This app is created using [Tauri](https://tauri.app/), a Rust🦀 framework for building a cross-platform desktop app. It uses [Vite](https://vite.dev/) as a frontend layer. The compression is done entirely by [FFmpeg](https://ffmpeg.org/) using platform specific standalone binaries.
The app works completely offline and no any network requests is made to/from the app.

### Downloads ⬇️

Download installers for the specific platform can be accessed from the [releases](https://github.com/codeforreal1/compressO/releases) page.

<strong>Installer Info:</strong>

- `CompressO_amd64.deb`: Debian derivative of Linux like Ubuntu
- `CompressO_amd64.AppImage`: Universal package for all Linux distros
- `CompressO_aarch64.dmg` : For Macbooks with Apple Silicon Chips
- `CompressO_x64.dmg` : For Macbooks with Intel Chip
- `CompressO_x64.msi`: Windows 64 bit
- `CompressO_x86.msi`: Windows 32 bit

### Roadmap 🏁

- [x] Cancel during compression
- [x] Drag & Drop video
- [x] Mute video
- [ ] Batch compression
      ...

### FAQs ❓

1.  <strong> MacOS: "CompressO" is damaged and can't be opened. You should move it to trash. </strong>
    !["CompressO" is damaged and can't be opened. You should move it to trash.](assets/image.png)
    <p>
    This error is shown by Apple to gatekeep app developers from using their apps unless it's signed by Apple after paying $100/year fee. The message is completely misleading since the app is not damaged at all. Since this is a free app, I'm not going to go Apple's route just to appease them to make people trust my app. Here's a simple solution for this issue. Open your terminal and run the command:
    </p>

        ```
        xattr -cr /Applications/CompressO.app
        ```

      <p>
           If you don't feel comfortable applying the above solution, you can simply move the app to trash (which also means you cannot use CompressO on your Mac).
        </p>

2.  <strong> MacOS: "CompressO" cannot be opened because developer cannot be verified. </strong>

    !["CompressO" cannot be opened because developer cannot be verified.](assets/image-1.png)

      <p>
        This error is same as the one above on FAQ 1. It's just, Apple made the message different to scare the end user. Please have a look at the solution above.
          </p>

    <br />

3.  <strong>Windows: Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.</strong>
    ![alt text](assets/image-2.png)

    This is because you downloaded the windows installer from outside source and Windows Defender is warning you before installation. You can simply click on "More Info" and proceed with the installation.

4.  <strong>App not working on Debian 13 & Ubuntu 24 </strong>
    <p>
    Tauri seems to be missing some packages that was removed in Debian 13 and it's derivatives like Ubuntu 24. Tauri team is investigating the issue. No solution atm, unfortunately.
    </p>

### License 🚨

<a href="./LICENSE">AGPL 3.0 License</a>

<p className="block text-sm">
This software uses libraries from the FFmpeg project under the LGPLv2.1.
</p>
