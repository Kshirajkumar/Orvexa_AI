use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path};
use std::time::{Duration, SystemTime};
use tauri::Manager;
use uuid::Uuid;

const OPENROUTER_CREDENTIAL_TARGET: &str = "TaxFlow.AI.OpenRouter";

fn validate_openrouter_key(api_key: &str) -> Result<(), String> {
    let api_key = api_key.trim();
    if !api_key.starts_with("sk-or-v1-")
        || api_key.len() <= "sk-or-v1-".len()
        || api_key.len() > 1024
    {
        return Err("Enter a valid OpenRouter API key beginning with sk-or-v1-.".into());
    }
    Ok(())
}

#[cfg(windows)]
mod windows_credentials {
    use super::OPENROUTER_CREDENTIAL_TARGET;
    use std::ptr::null_mut;
    use std::slice;
    use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
    use windows_sys::Win32::Security::Credentials::{
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree,
        CredReadW, CredWriteW,
    };

    fn target_name() -> Vec<u16> {
        OPENROUTER_CREDENTIAL_TARGET
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect()
    }

    pub fn save(api_key: &str) -> Result<(), String> {
        let mut target = target_name();
        let mut username = "OpenRouter\0".encode_utf16().collect::<Vec<_>>();
        let mut secret = api_key.as_bytes().to_vec();
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_mut_ptr();
        credential.CredentialBlobSize = secret.len() as u32;
        credential.CredentialBlob = secret.as_mut_ptr();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = username.as_mut_ptr();

        let saved = unsafe { CredWriteW(&credential, 0) } != 0;
        secret.fill(0);
        if !saved {
            return Err(format!(
                "Windows Credential Manager could not save the OpenRouter key: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    pub fn read() -> Result<Option<String>, String> {
        let target = target_name();
        let mut credential = null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!(
                "Windows Credential Manager could not read the OpenRouter key: {}",
                std::io::Error::last_os_error()
            ));
        }

        let decoded = unsafe {
            let credential = &*credential;
            if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
                Err("The saved OpenRouter key is empty.".to_string())
            } else {
                let bytes = slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                );
                std::str::from_utf8(bytes)
                    .map(str::to_owned)
                    .map_err(|_| "The saved OpenRouter key is invalid.".to_string())
            }
        };
        unsafe { CredFree(credential.cast()) };
        decoded.map(Some)
    }

    pub fn delete() -> Result<(), String> {
        let target = target_name();
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err(format!(
                "Windows Credential Manager could not remove the OpenRouter key: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[tauri::command]
fn save_openrouter_api_key(api_key: String) -> Result<(), String> {
    validate_openrouter_key(&api_key)?;
    #[cfg(windows)]
    return windows_credentials::save(api_key.trim());
    #[cfg(not(windows))]
    Err("Secure OpenRouter key storage is available only in the Windows desktop app.".into())
}

#[tauri::command]
fn get_openrouter_api_key() -> Result<Option<String>, String> {
    #[cfg(windows)]
    return windows_credentials::read();
    #[cfg(not(windows))]
    Err("Secure OpenRouter key storage is available only in the Windows desktop app.".into())
}

#[tauri::command]
fn has_openrouter_api_key() -> Result<bool, String> {
    get_openrouter_api_key().map(|api_key| api_key.is_some())
}

#[tauri::command]
fn delete_openrouter_api_key() -> Result<(), String> {
    #[cfg(windows)]
    return windows_credentials::delete();
    #[cfg(not(windows))]
    Err("Secure OpenRouter key storage is available only in the Windows desktop app.".into())
}

#[tauri::command]
fn open_file_with_default_app(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    const MAX_OPEN_FILE_BYTES: usize = 100 * 1024 * 1024;
    if bytes.is_empty() {
        return Err("The file is empty and cannot be opened.".into());
    }
    if bytes.len() > MAX_OPEN_FILE_BYTES {
        return Err("Files larger than 100 MB cannot be opened through TaxFlow.".into());
    }

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve the temporary document folder: {error}"))?;
    let open_dir = cache_root.join("opened-documents");
    fs::create_dir_all(&open_dir)
        .map_err(|error| format!("Could not prepare the temporary document folder: {error}"))?;
    let canonical_open_dir = fs::canonicalize(&open_dir)
        .map_err(|error| format!("Could not verify the temporary document folder: {error}"))?;
    let safe_name = safe_file_name(&file_name)?;
    let destination = canonical_open_dir.join(format!("{}-{safe_name}", Uuid::new_v4()));

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| format!("Could not prepare this file for the default app: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        if let Err(cleanup_error) = fs::remove_file(&destination) {
            log::warn!("Could not remove an incomplete temporary open file: {cleanup_error}");
        }
        return Err(format!("Could not save a temporary copy of this file: {error}"));
    }
    drop(file);

    if let Err(error) = open::that_detached(&destination) {
        if let Err(cleanup_error) = fs::remove_file(&destination) {
            log::warn!("Could not remove a temporary file after the default app failed: {cleanup_error}");
        }
        return Err(format!("No default application could open this file: {error}"));
    }

    let cleanup_before = SystemTime::now()
        .checked_sub(Duration::from_secs(7 * 24 * 60 * 60));
    if let Some(cleanup_before) = cleanup_before {
        match fs::read_dir(&canonical_open_dir) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => match entry.metadata() {
                            Ok(metadata) if metadata.is_file() => {
                                if metadata.modified().is_ok_and(|modified| modified < cleanup_before)
                                    && entry.file_name() != destination.file_name().unwrap_or_default()
                                {
                                    if let Err(error) = fs::remove_file(entry.path()) {
                                        log::warn!("Could not remove an expired temporary open file: {error}");
                                    }
                                }
                            }
                            Ok(_) => {}
                            Err(error) => log::warn!("Could not inspect a temporary open file: {error}"),
                        },
                        Err(error) => log::warn!("Could not inspect the temporary open-file cache: {error}"),
                    }
                }
            }
            Err(error) => log::warn!("Could not inspect the temporary open-file cache: {error}"),
        }
    }

    Ok(())
}

fn safe_file_name(value: &str) -> Result<String, String> {
    let name = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ')
        })
        .take(200)
        .collect::<String>();
    let path = Path::new(&name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("The remote document filename is not safe to save.".into());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::{safe_file_name, validate_openrouter_key};

    #[test]
    fn unsafe_document_names_cannot_become_path_components() {
        assert!(safe_file_name("").is_err());
        assert!(safe_file_name("..").is_err());
        assert_eq!(safe_file_name("../invoice.pdf").unwrap(), "..invoice.pdf");
    }

    #[test]
    fn openrouter_key_validation_rejects_empty_or_unrecognized_keys() {
        assert!(validate_openrouter_key("sk-or-v1-test-key").is_ok());
        assert!(validate_openrouter_key("").is_err());
        assert!(validate_openrouter_key("not-an-openrouter-key").is_err());
        assert!(validate_openrouter_key(&format!("sk-or-v1-{}", "x".repeat(1024))).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri::Manager;

        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            open_file_with_default_app,
            save_openrouter_api_key,
            get_openrouter_api_key,
            has_openrouter_api_key,
            delete_openrouter_api_key
        ])
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(windows)]
            app.get_webview_window("main")
                .expect("main window is missing")
                .set_icon(tauri::image::Image::from_app_icon_resource(128)?)?;

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
