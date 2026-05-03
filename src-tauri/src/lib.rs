mod connections;
mod commands_conns;
mod commands_s3;
mod commands_transfers;
mod error;
mod s3;
mod state;

use tauri::Manager;

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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
