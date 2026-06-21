use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefOverrides {
    pub button_side: Option<String>, // "left" | "right" | absent = auto
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedButtonSide {
    pub side: String,   // "left" | "right"
    pub source: String, // "env" | "gnome" | "kde" | "default" | "macos" | "windows"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefs {
    pub button_side: String,
    pub detected: DetectedButtonSide,
    pub overrides: DesktopPrefOverrides,
}

pub fn load_overrides(path: &Path) -> DesktopPrefOverrides {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_overrides(path: &Path, overrides: &DesktopPrefOverrides) -> Result<(), String> {
    let json = serde_json::to_string_pretty(overrides).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn compute_prefs(detected: &DetectedButtonSide, overrides: &DesktopPrefOverrides) -> DesktopPrefs {
    let button_side = overrides
        .button_side
        .clone()
        .unwrap_or_else(|| detected.side.clone());
    DesktopPrefs {
        button_side,
        detected: detected.clone(),
        overrides: overrides.clone(),
    }
}

pub fn detect_button_side() -> DetectedButtonSide {
    if let Ok(val) = std::env::var("WRAZZ_BUTTON_SIDE") {
        let side = val.trim().to_lowercase();
        if side == "left" || side == "right" {
            return DetectedButtonSide { side, source: "env".to_string() };
        }
    }
    detect_platform()
}

#[cfg(target_os = "macos")]
fn detect_platform() -> DetectedButtonSide {
    DetectedButtonSide { side: "left".to_string(), source: "macos".to_string() }
}

#[cfg(target_os = "windows")]
fn detect_platform() -> DetectedButtonSide {
    DetectedButtonSide { side: "right".to_string(), source: "windows".to_string() }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn detect_platform() -> DetectedButtonSide {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();

    let is_gnome = desktop.split(':').any(|s| matches!(s, "gnome" | "unity" | "pop"));
    let is_kde = desktop.split(':').any(|s| matches!(s, "kde" | "plasma"));

    if is_gnome {
        if let Some(side) = gnome_button_side() {
            return DetectedButtonSide { side, source: "gnome".to_string() };
        }
    }
    if is_kde {
        if let Some(side) = kde_button_side() {
            return DetectedButtonSide { side, source: "kde".to_string() };
        }
    }
    DetectedButtonSide { side: "right".to_string(), source: "default".to_string() }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn gnome_button_side() -> Option<String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.wm.preferences", "button-layout"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let raw = String::from_utf8(out.stdout).ok()?;
    // Format: 'left_buttons:right_buttons'  (single-quoted by gsettings)
    // Whichever side contains "close" determines button placement.
    let layout = raw.trim().trim_matches('\'');
    let colon = layout.find(':')?;
    if layout[..colon].contains("close") {
        Some("left".to_string())
    } else {
        Some("right".to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn kde_button_side() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".config").join("kwinrc");
    let content = std::fs::read_to_string(path).ok()?;
    // KDE uses letters to encode buttons: X=close, I=minimize, A=maximize.
    // We only care which side has X (close).
    let mut in_section = false;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line.eq_ignore_ascii_case("[org.kde.kdecoration2]");
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some(v) = line.strip_prefix("ButtonsOnLeft=") {
            if v.contains('X') {
                return Some("left".to_string());
            }
        }
        if let Some(v) = line.strip_prefix("ButtonsOnRight=") {
            if v.contains('X') {
                return Some("right".to_string());
            }
        }
    }
    None
}
