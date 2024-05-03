use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CompressionResult {
    pub file_name: String,
    pub output_path: String,
}
