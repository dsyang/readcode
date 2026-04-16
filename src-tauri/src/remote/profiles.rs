use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    #[serde(alias = "connect_command")]
    pub ssh_host: String,
    pub repo_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ProfilesFile {
    profiles: Vec<ConnectionProfile>,
}

fn profiles_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("connection_profiles.json")
}

pub fn load(app_data_dir: &Path) -> Result<Vec<ConnectionProfile>, String> {
    let path = profiles_path(app_data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read profiles: {e}"))?;
    let file: ProfilesFile =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse profiles: {e}"))?;
    Ok(file.profiles)
}

pub fn save(app_data_dir: &Path, profiles: &[ConnectionProfile]) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| format!("create data dir: {e}"))?;
    let path = profiles_path(app_data_dir);
    let file = ProfilesFile {
        profiles: profiles.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("write profiles: {e}"))?;
    Ok(())
}

pub fn upsert(
    app_data_dir: &Path,
    profile: ConnectionProfile,
) -> Result<Vec<ConnectionProfile>, String> {
    let mut profiles = load(app_data_dir)?;
    if let Some(existing) = profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        profiles.push(profile);
    }
    save(app_data_dir, &profiles)?;
    Ok(profiles)
}

pub fn delete(app_data_dir: &Path, id: &str) -> Result<Vec<ConnectionProfile>, String> {
    let mut profiles = load(app_data_dir)?;
    profiles.retain(|p| p.id != id);
    save(app_data_dir, &profiles)?;
    Ok(profiles)
}
