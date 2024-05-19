<div align="center">
  <div align="center">
   <img width="100" height="100" src="public/logo.png" alt="Logo">
  </div>
	<h1 align="center">CompressO</h1>
	<p align="center">
		Compress any video into a tiny size
    </p>
    <i align="center">
		CompressO is a free and open-sourced cross-platform video compression app powered by FFmpeg.
    </i>
    <br />
    <p align="center">
		Available for <strong>Linux</strong>, <strong>Windows</strong> & <strong>MacOS</strong>.
    </p>
    <p>
      <strong>Download</strong>
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

### Tech

This app is created using [Tauri](https://tauri.app/), a Rust🦀 framework for building a cross-platform desktop app. It uses [Next.js](https://nextjs.org/) as a frontend layer. The compression is done entirely by [FFmpeg](https://ffmpeg.org/) using platform specific standalone binaries.
The app works completely offline and no any network requests is made to/from the app.

### FAQs

1. <strong> MacOS: "CompressO" is damaged and can't be opened. You should move it to trash. </strong>
   !["CompressO" is damaged and can't be opened. You should move it to trash.](assets/image.png)
   This error is shown by Apple to gatekeep app developers from using their apps unless it's signed by Apple after paying $100/year fee. The message is completely misleading since the app is not damaged at all. Since this is a free app, I'm not going to go Apple's route just to appease them to make people trust my app. Here's a simple solution for this issue. Open your terminal and run the command:

   ```
   xattr -cr /Applications/CompressO.app
   ```

   If you don't feel comfortable applying the above solution, you can simply move the app to trash (which also means you cannot use CompressO on your Mac).

<br />

2. <strong> MacOS: "CompressO" cannot be opened because developer cannot be verified. </strong>
   !["CompressO" cannot be opened because developer cannot be verified.](assets/image-1.png)
   This error is same as the one above on FAQ 1. It's just, Apple made the message different to scare the end user. Please have a look at the solution above.

### License

<a href="./LICENSE">AGPL 3.0 License</a>

<p className="block text-sm">
This software uses libraries from the FFmpeg project under the LGPLv2.1.
</p>
