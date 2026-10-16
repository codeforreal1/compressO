use axum::{
    body::Body,
    extract::{Query, Request, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::path::{Component, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_util::io::ReaderStream;
use tower_http::cors::Any;
use tower_http::cors::CorsLayer;

#[derive(Debug, Deserialize)]
struct VideoQuery {
    /// The server's secret (see `ServerState::token`)
    token: String,
    path: String,
}

#[derive(Clone)]
pub struct ServerState {
    pub port: u16,
    /// A random secret made at each start, required by every request, so only CompressO (which
    /// builds the links, see `construct_video_url`) can read files through the server
    pub token: String,
    pub shutdown_tx: broadcast::Sender<()>,
}

/// What the requests are checked against
#[derive(Clone)]
struct ServerContext {
    token: String,
    app_handle: AppHandle,
}

/// The video server, started when the frontend asks for it: only with video previews on (Settings ->
/// General), read when the app starts
#[derive(Default)]
pub struct VideoServer(pub Mutex<Option<ServerState>>);

pub async fn start_server(
    app_handle: AppHandle,
) -> Result<ServerState, Box<dyn std::error::Error + Send + Sync>> {
    let (shutdown_tx, mut shutdown_rx) = broadcast::channel(1);
    let token = nanoid::nanoid!(32);

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    log::info!("Starting local video server on port {}", port);

    let cors = configure_cors();

    let app = Router::new()
        .route("/video", get(serve_video))
        .route("/ping", get(ping))
        .with_state(ServerContext {
            token: token.clone(),
            app_handle,
        })
        .layer(cors);

    let server = axum::serve(listener, app);

    tokio::spawn(async move {
        log::info!("Video server is now accepting connections on port {}", port);

        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    log::error!("Video server error: {:?}", e);
                } else {
                    log::info!("Video server shut down gracefully");
                }
            }
            _ = shutdown_rx.recv() => {
                log::info!("Video server shutdown signal received");
            }
        }
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    log::info!("Video server started successfully on port {}", port);

    Ok(ServerState {
        port,
        token,
        shutdown_tx,
    })
}

pub fn shutdown_server(state: &ServerState) {
    let _ = state.shutdown_tx.send(());
    log::info!("Video server shutdown signal sent");
}

async fn ping() -> &'static str {
    "pong"
}

async fn serve_video(
    State(context): State<ServerContext>,
    Query(params): Query<VideoQuery>,
    request: Request,
) -> Result<Response, StatusCode> {
    if params.token != context.token {
        log::error!("Video request with a wrong token");
        return Err(StatusCode::FORBIDDEN);
    }

    let path = PathBuf::from(&params.path);

    // Only the files CompressO opened or created: those its asset protocol may load (its data
    // folder, the media added, the saved outputs), as on macOS & Windows. Without `..`, which could
    // leave an allowed folder.
    let is_allowed = path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        && context.app_handle.asset_protocol_scope().is_allowed(&path);
    if !is_allowed {
        log::error!("Video request for a file CompressO did not open: {:?}", path);
        return Err(StatusCode::FORBIDDEN);
    }

    if !path.exists() {
        log::error!("Video file not found: {:?}", path);
        return Err(StatusCode::NOT_FOUND);
    }

    if !path.is_file() {
        log::error!("Path is not a file: {:?}", path);
        return Err(StatusCode::FORBIDDEN);
    }

    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(e) => {
            log::error!("Failed to get file metadata: {:?}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let file_len = metadata.len();

    let mime_type = mime_type_from_path(&path);

    let file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(e) => {
            log::error!("Failed to open file: {:?}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let headers = request.headers();
    let range_header = headers.get(header::RANGE);

    if let Some(range) = range_header {
        let range_str = match range.to_str() {
            Ok(s) => s,
            Err(_) => return Err(StatusCode::BAD_REQUEST),
        };

        if let Some((start, end)) = parse_range_header(range_str, file_len) {
            let content_length = end - start + 1;

            let mut file = match tokio::fs::File::open(&path).await {
                Ok(f) => f,
                Err(e) => {
                    log::error!("Failed to reopen file for range request: {:?}", e);
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            };

            match file.seek(std::io::SeekFrom::Start(start)).await {
                Ok(_) => {}
                Err(e) => {
                    log::error!("Failed to seek in file: {:?}", e);
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            }

            let stream = ReaderStream::new(file.take(content_length));
            let body = Body::from_stream(stream);

            return Ok((
                StatusCode::PARTIAL_CONTENT,
                [(header::CONTENT_TYPE, mime_type)],
                [(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, file_len),
                )],
                [(header::CONTENT_LENGTH, content_length.to_string())],
                [(header::ACCEPT_RANGES, "bytes")],
                body,
            )
                .into_response());
        }
    }

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, mime_type)],
        [(header::CONTENT_LENGTH, file_len.to_string())],
        [(header::ACCEPT_RANGES, "bytes")],
        body,
    )
        .into_response())
}

fn parse_range_header(range: &str, file_len: u64) -> Option<(u64, u64)> {
    let range = range.strip_prefix("bytes=")?;

    let parts: Vec<&str> = range.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start: u64 = parts[0].parse().ok()?;

    let end = if parts[1].is_empty() {
        file_len - 1
    } else {
        parts[1].parse().ok()?
    };

    if start >= file_len || end >= file_len || start > end {
        return None;
    }

    Some((start, end))
}

fn mime_type_from_path(path: &PathBuf) -> &'static str {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| match ext.to_lowercase().as_str() {
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mkv" => "video/x-matroska",
            "avi" => "video/x-msvideo",
            "ts" | "mts" | "m2ts" => "video/mp2t",
            "mov" => "video/quicktime",
            "flv" => "video/x-flv",
            "m4v" => "video/x-m4v",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" | "opus" => "audio/ogg",
            "flac" => "audio/flac",
            "m4a" => "audio/mp4",
            "aac" => "audio/aac",
            "aiff" | "aif" => "audio/aiff",
            "m4b" => "audio/mp4",
            "oga" => "audio/ogg",
            "mp2" => "audio/mpeg",
            "wma" => "audio/x-ms-wma",
            _ => "application/octet-stream",
        })
        .unwrap_or("application/octet-stream")
}

fn configure_cors() -> CorsLayer {
    #[cfg(debug_assertions)]
    {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([axum::http::Method::GET])
            .allow_headers(Any)
            .max_age(Duration::from_secs(3600))
    }

    #[cfg(not(debug_assertions))]
    {
        CorsLayer::new()
            .allow_origin("tauri://localhost".parse::<HeaderValue>().unwrap())
            .allow_methods([axum::http::Method::GET])
            .allow_headers(Any)
            .max_age(Duration::from_secs(3600))
    }
}
