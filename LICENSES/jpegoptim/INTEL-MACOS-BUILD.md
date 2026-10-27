The Intel macOS jpegoptim 1.5.6 executable links libjpeg-turbo 3.2.0 statically and
depends only on Apple's libSystem. The former executable required an unbundled
Homebrew library at /usr/local/opt/jpeg-turbo/lib/libjpeg.8.dylib.

The JSON beside this file pins executable and source hashes. The matching jpegoptim
source archive is preserved under jpegoptim/ in the combined dependency-source release
download. The libjpeg source,
vcpkg recipes, and build script are in image-codecs-x86_64-apple-darwin.tar.gz.
The libjpeg copyright is included under LICENSES/image-codecs/x86_64-apple-darwin/.

Rebuild libjpeg using the existing x86_64 macOS codec source build, then unpack the
jpegoptim archive and run the following from its source directory. Set jpeg_prefix
to that build's installed/x64-osx directory (containing include/ and lib/libjpeg.a).

```sh
env CC='clang -arch x86_64' \
  CFLAGS='-O2 -mmacosx-version-min=11.0' \
  CPPFLAGS="-I${jpeg_prefix}/include" \
  LDFLAGS="-L${jpeg_prefix}/lib -arch x86_64 -mmacosx-version-min=11.0" \
  ./configure --host=x86_64-apple-darwin
make -j4
strip -S jpegoptim
otool -L jpegoptim
```

The recorded build used Apple Clang with the macOS 27 SDK and an explicit macOS 11
deployment target. Packaging signs its copy of the executable before archiving.
Run node scripts/check-image-encoders.mjs x86_64-apple-darwin after importing it.
