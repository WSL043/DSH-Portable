fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["portable_host_message"]),
        ),
    )
    .expect("failed to build the Linux host contract")
}
