//! Tauri commands exposing central Rust `core::settings` and `core::presets` state and
//! one-time migration from frontend `localStorage`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::core::presets::{self, PresetsStoreData};
use crate::core::settings::{self, DomainSettings};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoreMigrationResult {
    pub settings: DomainSettings,
    pub presets: PresetsStoreData,
    pub migrated_settings: bool,
    pub migrated_presets: bool,
}

#[tauri::command]
pub fn migrate_core_state(
    app_handle: AppHandle,
    settings: DomainSettings,
    presets: PresetsStoreData,
) -> Result<CoreMigrationResult, String> {
    let (auth_settings, migrated_settings) = settings::migrate_from_frontend(&app_handle, settings)?;
    let (auth_presets, migrated_presets) = presets::migrate_from_frontend(&app_handle, presets)?;
    Ok(CoreMigrationResult {
        settings: auth_settings,
        presets: auth_presets,
        migrated_settings,
        migrated_presets,
    })
}

#[tauri::command]
pub fn get_core_settings(app_handle: AppHandle) -> DomainSettings {
    settings::get(&app_handle)
}

#[tauri::command]
pub fn save_core_settings(
    app_handle: AppHandle,
    settings: DomainSettings,
) -> Result<DomainSettings, String> {
    settings::save(&app_handle, settings)
}

#[tauri::command]
pub fn get_core_presets(app_handle: AppHandle) -> PresetsStoreData {
    presets::get(&app_handle)
}

#[tauri::command]
pub fn save_core_presets(
    app_handle: AppHandle,
    presets: PresetsStoreData,
) -> Result<PresetsStoreData, String> {
    presets::save(&app_handle, presets)
}
