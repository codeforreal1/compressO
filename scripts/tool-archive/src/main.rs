//! Host-native archive packer. Requires only the Rust toolchain already used by Tauri.
use std::{
    error::Error,
    fs::{self, File},
    io::{self, BufWriter, Write},
    path::Path,
};

fn create_tar(source: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let mut files = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    files.sort_by_key(|entry| entry.file_name());
    let mut archive = tar::Builder::new(BufWriter::new(File::create(output)?));
    for entry in files {
        let metadata = fs::symlink_metadata(entry.path())?;
        if !metadata.is_file() {
            return Err(format!("Expected a regular tool file: {}", entry.path().display()).into());
        }
        let mut header = tar::Header::new_ustar();
        header.set_size(metadata.len());
        header.set_mode(0o755);
        header.set_uid(0);
        header.set_gid(0);
        header.set_mtime(0);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        archive.append_data(&mut header, entry.file_name(), File::open(entry.path())?)?;
    }
    archive.into_inner()?.flush()?;
    Ok(())
}

fn pack(source: &Path, tar: &Path, format: &str, compressed: &Path) -> Result<(), Box<dyn Error>> {
    if !matches!(format, "tar" | "xz") {
        return Err(format!("Unsupported archive format: {format}").into());
    }
    create_tar(source, tar)?;
    if format == "xz" {
        let mut encoder = xz2::write::XzEncoder::new(BufWriter::new(File::create(compressed)?), 9);
        io::copy(&mut File::open(tar)?, &mut encoder)?;
        encoder.finish()?.flush()?;
    }
    Ok(())
}

fn main() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    let result = if arguments.len() == 4 {
        pack(
            Path::new(&arguments[0]),
            Path::new(&arguments[1]),
            &arguments[2].to_string_lossy(),
            Path::new(&arguments[3]),
        )
    } else {
        Err(
            "Usage: compresso-tool-archive <source-directory> <tar-output> <tar|xz> <xz-output>"
                .into(),
        )
    };
    if let Err(error) = result {
        eprintln!("Tool archive creation failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Read, path::PathBuf, time::SystemTime};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("compresso-archive-{}-{id}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn deterministic_xz_roundtrip_preserves_tool_names_bytes_and_permissions() {
        let temp = Fixture::new();
        let source = temp.0.join("tools with spaces");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("ffprobe.exe"), b"probe bytes").unwrap();
        fs::write(source.join("ffmpeg.exe"), b"video bytes").unwrap();
        let tar = temp.0.join("tools.tar");
        let xz = temp.0.join("tools.tar.xz");
        pack(&source, &tar, "xz", &xz).unwrap();
        let first = fs::read(&xz).unwrap();
        pack(&source, &tar, "xz", &xz).unwrap();
        assert_eq!(first, fs::read(&xz).unwrap());
        let mut decoded = Vec::new();
        xz2::read::XzDecoder::new(File::open(&xz).unwrap())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, fs::read(&tar).unwrap());
        let mut archive = tar::Archive::new(decoded.as_slice());
        let mut entries = archive.entries().unwrap();
        for (name, bytes) in [
            ("ffmpeg.exe", "video bytes"),
            ("ffprobe.exe", "probe bytes"),
        ] {
            let mut entry = entries.next().unwrap().unwrap();
            assert_eq!(entry.path().unwrap(), Path::new(name));
            assert_eq!(entry.header().mtime().unwrap(), 0);
            assert_eq!(entry.header().mode().unwrap(), 0o755);
            let mut content = String::new();
            entry.read_to_string(&mut content).unwrap();
            assert_eq!(content, bytes);
        }
        assert!(entries.next().is_none());
    }

    #[test]
    fn tar_only_mode_produces_no_xz_file() {
        let temp = Fixture::new();
        let source = temp.0.join("tools");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("ffmpeg"), b"tool").unwrap();
        let tar = temp.0.join("tools.tar");
        let xz = temp.0.join("unused.xz");
        pack(&source, &tar, "tar", &xz).unwrap();
        assert!(tar.is_file());
        assert!(!xz.exists());
    }
}
