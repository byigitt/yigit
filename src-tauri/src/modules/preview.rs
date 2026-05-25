use tauri::{AppHandle, Manager, Url, Webview};

/// Look up the child webview the frontend created via `new Webview(...)`.
/// The label is the preview tab id stringified; missing means the React
/// `<PreviewPane>` hasn't mounted yet or already unmounted.
fn find(app: &AppHandle, label: &str) -> Result<Webview, String> {
    // `get_webview_window` only returns single-webview windows; the main
    // window stops qualifying as soon as we attach child preview webviews
    // to it, so we go through the raw `Window` accessor instead.
    let win = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    win.webviews()
        .into_iter()
        .find(|w| w.label() == label)
        .ok_or_else(|| format!("preview webview '{label}' not found"))
}

#[tauri::command]
pub fn preview_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let parsed: Url = url.parse().map_err(|e| format!("{e}"))?;
    find(&app, &label)?
        .navigate(parsed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_reload(app: AppHandle, label: String) -> Result<(), String> {
    // `Webview::reload` isn't exposed; eval'ing `location.reload()` is the
    // cross-platform equivalent for cross-origin pages where contentWindow
    // reload would throw.
    find(&app, &label)?
        .eval("location.reload()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_open_devtools(app: AppHandle, label: String) -> Result<(), String> {
    find(&app, &label)?.open_devtools();
    Ok(())
}
