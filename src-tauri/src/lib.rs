use base64::{engine::general_purpose::STANDARD, Engine};

/// 供前端在 Tauri 环境下保存导出文件（txt/epub）到用户选择的位置。
#[tauri::command]
fn save_file(path: String, base64_data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
