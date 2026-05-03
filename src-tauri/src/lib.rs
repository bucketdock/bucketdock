mod connections;
mod commands_conns;
mod commands_s3;
mod commands_transfers;
mod error;
mod s3;
mod state;

use tauri::menu::{
    AboutMetadata, AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::{Emitter, Manager, WindowEvent};

const WEBSITE_URL: &str = "https://bucketdock.com";
const REPO_URL: &str = "https://github.com/bucketdock/bucketdock";
const DOCS_URL: &str = "https://bucketdock.com/docs.html";
const ISSUES_URL: &str = "https://github.com/bucketdock/bucketdock/issues";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let state = state::AppState::new().expect("init state");
      app.manage(state);

      // ── Native application menu (macOS bar; Windows/Linux: window menu)
      let app_handle = app.handle();
      let about_metadata: AboutMetadata = AboutMetadataBuilder::new()
          .name(Some("BucketDock"))
          .version(Some(env!("CARGO_PKG_VERSION")))
          .website(Some(WEBSITE_URL))
          .website_label(Some("bucketdock.com"))
          .copyright(Some("© BucketDock contributors. Apache License 2.0."))
          .build();

      // App submenu (macOS shows this with the bundle name)
      let app_submenu = SubmenuBuilder::new(app_handle, "BucketDock")
          .item(&PredefinedMenuItem::about(app_handle, Some("About BucketDock"), Some(about_metadata))?)
          .separator()
          .item(&PredefinedMenuItem::services(app_handle, None)?)
          .separator()
          .item(&PredefinedMenuItem::hide(app_handle, None)?)
          .item(&PredefinedMenuItem::hide_others(app_handle, None)?)
          .item(&PredefinedMenuItem::show_all(app_handle, None)?)
          .separator()
          .item(&PredefinedMenuItem::quit(app_handle, None)?)
          .build()?;

      // File submenu — emits "menu://action" with payload describing the action.
      let file_submenu = SubmenuBuilder::new(app_handle, "File")
          .item(&MenuItemBuilder::with_id("file:new_connection", "New Connection…")
              .accelerator("CmdOrCtrl+N")
              .build(app_handle)?)
          .separator()
          .item(&MenuItemBuilder::with_id("file:new_folder", "New Folder…")
              .accelerator("CmdOrCtrl+Shift+N")
              .build(app_handle)?)
          .item(&MenuItemBuilder::with_id("file:upload_files", "Upload Files…")
              .accelerator("CmdOrCtrl+U")
              .build(app_handle)?)
          .item(&MenuItemBuilder::with_id("file:upload_folder", "Upload Folder…")
              .build(app_handle)?)
          .separator()
          .item(&MenuItemBuilder::with_id("file:refresh", "Refresh")
              .accelerator("CmdOrCtrl+R")
              .build(app_handle)?)
          .item(&MenuItemBuilder::with_id("file:get_info", "Get Info")
              .accelerator("CmdOrCtrl+I")
              .build(app_handle)?)
          .build()?;

      // Edit submenu — uses native predefined items so Cut/Copy/Paste work
      // in inputs even though we drive the rest from the frontend.
      let edit_submenu = SubmenuBuilder::new(app_handle, "Edit")
          .item(&PredefinedMenuItem::undo(app_handle, None)?)
          .item(&PredefinedMenuItem::redo(app_handle, None)?)
          .separator()
          .item(&PredefinedMenuItem::cut(app_handle, None)?)
          .item(&PredefinedMenuItem::copy(app_handle, None)?)
          .item(&PredefinedMenuItem::paste(app_handle, None)?)
          .item(&PredefinedMenuItem::select_all(app_handle, None)?)
          .separator()
          .item(&MenuItemBuilder::with_id("edit:find", "Find…")
              .accelerator("CmdOrCtrl+F")
              .build(app_handle)?)
          .build()?;

      // View submenu
      let view_submenu = SubmenuBuilder::new(app_handle, "View")
          .item(&PredefinedMenuItem::fullscreen(app_handle, None)?)
          .build()?;

      // Window submenu (standard macOS items)
      let window_submenu = SubmenuBuilder::new(app_handle, "Window")
          .item(&PredefinedMenuItem::minimize(app_handle, None)?)
          .item(&PredefinedMenuItem::maximize(app_handle, None)?)
          .separator()
          .item(&PredefinedMenuItem::close_window(app_handle, None)?)
          .build()?;

      // Help submenu
      let help_submenu = SubmenuBuilder::new(app_handle, "Help")
          .item(&MenuItemBuilder::with_id("help:website", "Visit Website")
              .build(app_handle)?)
          .item(&MenuItemBuilder::with_id("help:docs", "Documentation")
              .build(app_handle)?)
          .item(&MenuItemBuilder::with_id("help:repo", "GitHub Repository")
              .build(app_handle)?)
          .item(&MenuItemBuilder::with_id("help:issues", "Report an Issue")
              .build(app_handle)?)
          .build()?;

      let menu = MenuBuilder::new(app_handle)
          .item(&app_submenu)
          .item(&file_submenu)
          .item(&edit_submenu)
          .item(&view_submenu)
          .item(&window_submenu)
          .item(&help_submenu)
          .build()?;

      app_handle.set_menu(menu)?;

      // Wire menu events
      app_handle.on_menu_event(|app, event| {
          let id = event.id().0.as_str();
          match id {
              // Help links open in the default browser
              "help:website" => { let _ = open_external(app, WEBSITE_URL); }
              "help:docs" => { let _ = open_external(app, DOCS_URL); }
              "help:repo" => { let _ = open_external(app, REPO_URL); }
              "help:issues" => { let _ = open_external(app, ISSUES_URL); }
              // Everything else is forwarded to the frontend, which knows
              // about current selection / connection / bucket context.
              other => {
                  let _ = app.emit("menu://action", other.to_string());
              }
          }
      });

      // ── macOS: close button hides the window instead of quitting ─────────
      // Closing the last window on macOS is not the same as quitting; the
      // platform convention is for the red traffic-light button to *hide*
      // the window so it can be brought back from the dock. The reopen
      // handler below restores the window when the dock icon is clicked.
      #[cfg(target_os = "macos")]
      if let Some(win) = app_handle.get_webview_window("main") {
          let win_for_event = win.clone();
          win.on_window_event(move |event| {
              if let WindowEvent::CloseRequested { api, .. } = event {
                  api.prevent_close();
                  let _ = win_for_event.hide();
              }
          });
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands_conns::list_connections,
      commands_conns::add_connection,
      commands_conns::update_connection,
      commands_conns::delete_connection,
      commands_conns::test_connection,
      commands_s3::list_buckets,
      commands_s3::list_objects,
      commands_s3::upload_file,
      commands_s3::download_file,
      commands_s3::delete_object,
      commands_s3::delete_objects,
      commands_s3::create_folder,
      commands_s3::rename_object,
      commands_s3::get_presigned_url,
      commands_s3::get_object_metadata,
      commands_s3::update_object_metadata,
      commands_s3::upload_folder,
      commands_s3::download_folder,
      commands_s3::delete_prefix,
      commands_s3::rename_prefix,
      commands_s3::list_keys_under,
      commands_s3::read_object_preview,
      commands_transfers::upload_file_tracked,
      commands_transfers::download_file_tracked,
      commands_transfers::copy_object_tracked,
      commands_transfers::cancel_transfer,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
        // ── macOS dock-icon reactivation ────────────────────────────────
        // When the user clicks BucketDock in the dock and there are no
        // visible windows (because the close button hid the main window),
        // re-show and focus it. Without this handler the app would appear
        // unresponsive after the window is hidden.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
            if !has_visible_windows {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        }
        // Suppress unused-variable warnings on non-macOS builds.
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}

fn open_external(app: &tauri::AppHandle, url: &str) -> Result<(), tauri::Error> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e.to_string())))
}
