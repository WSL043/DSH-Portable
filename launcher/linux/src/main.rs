use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

const PRODUCT_NAME: &str = "DeepSeek-Herness";
const PORTABLE_DATA_NAME: &str = "DSH-Portable-data";
static LAYOUT: OnceLock<ProductLayout> = OnceLock::new();
static QUITTING: AtomicBool = AtomicBool::new(false);
static UPDATE_PROMPT_OPEN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize)]
struct ProductLayout {
    root: PathBuf,
    state_root: PathBuf,
    mode: &'static str,
}

#[derive(Debug, Deserialize)]
struct Components {
    #[serde(rename = "portableVersion")]
    portable_version: String,
    platform: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct ShellSettings {
    #[serde(rename = "checkUpdatesAtStartup")]
    check_updates_at_startup: bool,
    #[serde(rename = "installUpdateAtNextStart", default)]
    install_update_at_next_start: bool,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            check_updates_at_startup: false,
            install_update_at_next_start: false,
        }
    }
}

fn executable_dir() -> io::Result<PathBuf> {
    env::current_exe()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "launcher directory is unavailable"))
}

fn has_product_payload(root: &Path) -> bool {
    root.join("app/node_modules/@deepseek-ai/dsh/lib/bin.js")
        .is_file()
        && root.join("launcher/portable-cli.mjs").is_file()
        && root.join("runtime/node/bin/node").is_file()
        && root.join("licenses/COMPONENTS.json").is_file()
}

fn find_payload(root: &Path, depth: usize) -> Option<PathBuf> {
    if has_product_payload(root) {
        return Some(root.to_path_buf());
    }
    if depth == 0 {
        return None;
    }
    for entry in fs::read_dir(root).ok()?.flatten() {
        if entry.file_type().ok()?.is_dir() {
            if let Some(found) = find_payload(&entry.path(), depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn appimage_seed(resource_hint: Option<&Path>) -> io::Result<PathBuf> {
    if let Some(resource) = resource_hint {
        if let Some(found) = find_payload(&resource.join("payload"), 2) {
            return Ok(found);
        }
    }
    if let Some(appdir) = env::var_os("APPDIR") {
        if let Some(found) = find_payload(Path::new(&appdir), 6) {
            return Ok(found);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "the bundled DSH product payload is missing",
    ))
}

fn installed_state_root() -> io::Result<PathBuf> {
    if let Some(value) = env::var_os("XDG_DATA_HOME") {
        return Ok(PathBuf::from(value).join(PRODUCT_NAME));
    }
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is unavailable"))?;
    Ok(home.join(".local/share").join(PRODUCT_NAME))
}

fn read_components(root: &Path) -> io::Result<Components> {
    let source = fs::read_to_string(root.join("licenses/COMPONENTS.json"))?;
    serde_json::from_str(&source).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(unix)]
fn copy_symlink(source: &Path, target: &Path) -> io::Result<()> {
    let link = fs::read_link(source)?;
    std::os::unix::fs::symlink(link, target)
}

#[cfg(not(unix))]
fn copy_symlink(_source: &Path, _target: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Linux product symlinks cannot be materialized on this host",
    ))
}

fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            copy_symlink(&source_path, &target_path)?;
        } else if file_type.is_dir() {
            copy_tree(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
            fs::set_permissions(&target_path, fs::metadata(&source_path)?.permissions())?;
        }
    }
    Ok(())
}

fn cli_paths(root: &Path) -> (PathBuf, PathBuf) {
    (
        root.join("runtime/node/bin/node"),
        root.join("launcher/portable-cli.mjs"),
    )
}

fn run_portable_cli(layout: &ProductLayout, args: &[&str]) -> io::Result<Output> {
    let (node, cli) = cli_paths(&layout.root);
    Command::new(node)
        .arg(cli)
        .args(args)
        .env("DSH_PORTABLE", "1")
        .env("DSH_PORTABLE_STATE_ROOT", &layout.state_root)
        .stdin(Stdio::null())
        .output()
}

fn current_product_running(root: &Path, state_root: &Path) -> bool {
    let layout = ProductLayout {
        root: root.to_path_buf(),
        state_root: state_root.to_path_buf(),
        mode: "seeded",
    };
    let Ok(output) = run_portable_cli(&layout, &["status", "--json"]) else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .ok()
        .and_then(|value| {
            value
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .is_some_and(|status| status == "running" || status == "starting")
}

fn seed_product(seed: &Path, product: &Path, state_root: &Path) -> io::Result<()> {
    let incoming = read_components(seed)?;
    let current = read_components(product).ok();
    let incoming_version = Version::parse(&incoming.portable_version)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let current_is_usable = current.as_ref().is_some_and(|value| {
        value.platform == incoming.platform
            && Version::parse(&value.portable_version)
                .map(|version| version >= incoming_version)
                .unwrap_or(false)
    });
    if current_is_usable || current_product_running(product, state_root) {
        return Ok(());
    }

    fs::create_dir_all(state_root)?;
    let staging = state_root.join(format!(".product-seed-{}", std::process::id()));
    let backup = state_root.join(format!(".product-previous-{}", std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&backup);
    copy_tree(seed, &staging)?;
    if product.exists() {
        fs::rename(product, &backup)?;
    }
    match fs::rename(&staging, product) {
        Ok(()) => {
            let _ = fs::remove_dir_all(backup);
            Ok(())
        }
        Err(error) => {
            if backup.exists() {
                let _ = fs::rename(&backup, product);
            }
            let _ = fs::remove_dir_all(staging);
            Err(error)
        }
    }
}

fn resolve_layout(resource_hint: Option<&Path>) -> io::Result<ProductLayout> {
    let executable = executable_dir()?;
    if has_product_payload(&executable) {
        return Ok(ProductLayout {
            root: executable.clone(),
            state_root: executable,
            mode: "portable-folder",
        });
    }

    let seed = appimage_seed(resource_hint)?;
    let (state_root, mode) = if let Some(appimage) = env::var_os("APPIMAGE") {
        let parent = PathBuf::from(appimage)
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "AppImage directory is unavailable")
            })?;
        (parent.join(PORTABLE_DATA_NAME), "appimage")
    } else {
        (installed_state_root()?, "installed")
    };
    let product = state_root.join("product");
    seed_product(&seed, &product, &state_root)?;
    Ok(ProductLayout {
        root: product,
        state_root,
        mode,
    })
}

fn settings_file(layout: &ProductLayout) -> PathBuf {
    layout.state_root.join("data/runtime/linux-shell.json")
}

fn read_shell_settings(layout: &ProductLayout) -> ShellSettings {
    fs::read_to_string(settings_file(layout))
        .ok()
        .and_then(|source| serde_json::from_str(&source).ok())
        .unwrap_or_default()
}

fn write_shell_settings(layout: &ProductLayout, settings: &ShellSettings) -> io::Result<()> {
    let filename = settings_file(layout);
    if let Some(parent) = filename.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = filename.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&temporary, serde_json::to_vec_pretty(settings).unwrap())?;
    fs::rename(temporary, filename)
}

fn chinese_ui(layout: &ProductLayout) -> bool {
    let settings = layout.state_root.join("data/dsh-home/settings.yaml");
    if let Ok(source) = fs::read_to_string(settings) {
        let mut in_locale = false;
        for line in source.lines() {
            let trimmed = line.trim();
            if !line.starts_with(' ') && trimmed.ends_with(':') {
                in_locale = trimmed == "locale:";
                continue;
            }
            if in_locale && trimmed.starts_with("preference:") {
                return trimmed
                    .split_once(':')
                    .map(|(_, value)| value.trim().trim_matches(['\'', '"']).starts_with("zh"))
                    .unwrap_or(false);
            }
        }
    }
    env::var("LANG")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .starts_with("zh")
}

fn text(layout: &ProductLayout, chinese: &str, english: &str) -> String {
    if chinese_ui(layout) {
        chinese.to_owned()
    } else {
        english.to_owned()
    }
}

fn output_json(output: &Output) -> Result<Value, String> {
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if details.is_empty() {
            format!("DSH command exited with {}", output.status)
        } else {
            details
        });
    }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("invalid DSH response: {error}"))
}

fn dialog(title: &str, description: &str, level: MessageLevel) {
    MessageDialog::new()
        .set_title(title)
        .set_description(description)
        .set_level(level)
        .set_buttons(MessageButtons::Ok)
        .show();
}

fn check_updates(_app: tauri::AppHandle, interactive: bool) {
    if UPDATE_PROMPT_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let layout = LAYOUT.get().expect("layout is initialized").clone();
        let force = if interactive { "--force" } else { "--json" };
        let args = if interactive {
            vec!["check-update", "--json", force]
        } else {
            vec!["check-update", "--json"]
        };
        let result = run_portable_cli(&layout, &args)
            .map_err(|error| error.to_string())
            .and_then(|output| output_json(&output));
        match result {
            Ok(value) if value.get("status").and_then(Value::as_str) == Some("available") => {
                let latest = value.get("latest").and_then(Value::as_str).unwrap_or("new");
                let choice = MessageDialog::new()
                    .set_title(text(&layout, "DSH-Portable 更新", "DSH-Portable update"))
                    .set_description(text(
                        &layout,
                        &format!("发现新版本 {latest}。更新只替换应用组件，会保留会话、设置、插件与工作区。"),
                        &format!("Version {latest} is available. The update keeps sessions, settings, plugins, and the workspace."),
                    ))
                    .set_level(MessageLevel::Info)
                    .set_buttons(MessageButtons::YesNoCancel)
                    .show();
                if choice == MessageDialogResult::Yes {
                    let mut settings = read_shell_settings(&layout);
                    settings.install_update_at_next_start = true;
                    match write_shell_settings(&layout, &settings) {
                        Ok(()) => dialog(
                            PRODUCT_NAME,
                            &text(
                                &layout,
                                "已安排在下次启动前更新。当前任务不会被中断。",
                                "The update will install before the next launch. The current task will not be interrupted.",
                            ),
                            MessageLevel::Info,
                        ),
                        Err(error) => dialog(PRODUCT_NAME, &error.to_string(), MessageLevel::Error),
                    }
                } else if choice == MessageDialogResult::Cancel {
                    let _ = run_portable_cli(&layout, &["ignore-update", "--json"]);
                } else {
                    let _ = run_portable_cli(&layout, &["defer-update", "--json"]);
                }
            }
            Ok(value)
                if interactive
                    && value.get("status").and_then(Value::as_str) == Some("current") =>
            {
                dialog(
                    PRODUCT_NAME,
                    &text(&layout, "已经是最新版本。", "You are up to date."),
                    MessageLevel::Info,
                );
            }
            Ok(value)
                if value.get("status").and_then(Value::as_str) == Some("full-package-required") =>
            {
                let latest = value.get("latest").and_then(Value::as_str).unwrap_or("new");
                let choice = MessageDialog::new()
                    .set_title(text(&layout, "DSH-Portable 更新", "DSH-Portable update"))
                    .set_description(text(
                        &layout,
                        &format!("版本 {latest} 需要完整升级。当前版本可以继续使用。"),
                        &format!("Version {latest} requires a complete upgrade. You can keep using this version."),
                    ))
                    .set_level(MessageLevel::Info)
                    .set_buttons(MessageButtons::YesNoCancel)
                    .show();
                if choice == MessageDialogResult::Cancel {
                    let _ = run_portable_cli(&layout, &["ignore-update", "--json"]);
                } else if choice == MessageDialogResult::No {
                    let _ = run_portable_cli(&layout, &["defer-update", "--json"]);
                } else {
                    let release_url = value
                        .get("releaseUrl")
                        .and_then(Value::as_str)
                        .filter(|url| {
                            url.starts_with("https://github.com/WSL043/DSH-Portable/releases/tag/v")
                        })
                        .unwrap_or("https://github.com/WSL043/DSH-Portable/releases");
                    dialog(PRODUCT_NAME, release_url, MessageLevel::Info);
                }
            }
            Ok(_) => {}
            Err(error) if interactive => dialog(PRODUCT_NAME, &error, MessageLevel::Error),
            Err(_) => {}
        }
        UPDATE_PROMPT_OPEN.store(false, Ordering::SeqCst);
    });
}

fn stop_and_exit(app: tauri::AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        if let Some(layout) = LAYOUT.get() {
            let _ = run_portable_cli(layout, &["stop", "--json"]);
        }
        app.exit(0);
    });
}

fn open_dsh_terminal(layout: &ProductLayout) -> Result<(), String> {
    let helper = layout.root.join("launcher/dsh-terminal");
    if !helper.is_file() {
        return Err(text(
            layout,
            "便携终端文件缺失，请重新下载并完整解压。",
            "The Portable terminal is missing. Download and extract the package again.",
        ));
    }

    let candidates: [(&str, &[&str]); 8] = [
        ("xdg-terminal-exec", &["--"]),
        ("x-terminal-emulator", &["-e"]),
        ("gnome-terminal", &["--"]),
        ("kgx", &["--"]),
        ("konsole", &["-e"]),
        ("xterm", &["-e"]),
        ("kitty", &[]),
        ("alacritty", &["-e"]),
    ];
    let mut last_error = None;
    for (program, prefix) in candidates {
        let mut command = Command::new(program);
        command
            .args(prefix)
            .arg(&helper)
            .current_dir(&layout.root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command.spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => last_error = Some(format!("{program}: {error}")),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        text(
            layout,
            "未找到可用的终端程序。仍可在便携目录运行 ./dsh。",
            "No supported terminal application was found. You can still run ./dsh from the Portable folder.",
        )
    }))
}

fn setup_tray(app: &tauri::AppHandle, layout: &ProductLayout) -> tauri::Result<()> {
    let open = MenuItem::with_id(
        app,
        "open",
        text(layout, "打开 DeepSeek-Herness", "Open DeepSeek-Herness"),
        true,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(
        app,
        "check-update",
        text(layout, "检查更新", "Check for Updates"),
        true,
        None::<&str>,
    )?;
    let startup = CheckMenuItem::with_id(
        app,
        "startup-update",
        text(layout, "启动时检查更新", "Check for updates at startup"),
        true,
        read_shell_settings(layout).check_updates_at_startup,
        None::<&str>,
    )?;
    let terminal = MenuItem::with_id(
        app,
        "dsh-terminal",
        text(layout, "DSH 终端", "DSH Terminal"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        text(layout, "退出", "Quit"),
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open, &update, &startup, &terminal, &quit])?;
    let startup_for_event = startup.clone();
    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("bundle icon is configured")
                .clone(),
        )
        .tooltip(PRODUCT_NAME)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "check-update" => check_updates(app.clone(), true),
            "startup-update" => {
                if let Some(layout) = LAYOUT.get() {
                    let checked = startup_for_event.is_checked().unwrap_or(true);
                    let mut settings = read_shell_settings(layout);
                    settings.check_updates_at_startup = checked;
                    let _ = write_shell_settings(layout, &settings);
                }
            }
            "dsh-terminal" => {
                if let Some(layout) = LAYOUT.get() {
                    if let Err(error) = open_dsh_terminal(layout) {
                        dialog(PRODUCT_NAME, &error, MessageLevel::Error);
                    }
                }
            }
            "quit" => stop_and_exit(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn apply_pending_update(layout: &ProductLayout) -> Result<(), String> {
    let mut settings = read_shell_settings(layout);
    if !settings.install_update_at_next_start {
        return Ok(());
    }
    run_portable_cli(layout, &["update", "--json", "--no-browser"])
        .map_err(|error| error.to_string())
        .and_then(|output| output_json(&output))?;
    settings.install_update_at_next_start = false;
    write_shell_settings(layout, &settings).map_err(|error| error.to_string())?;
    Ok(())
}

fn start_dsh(app: tauri::AppHandle) {
    thread::spawn(move || {
        let layout = LAYOUT.get().expect("layout is initialized").clone();
        if let Err(error) = apply_pending_update(&layout) {
            dialog(
                PRODUCT_NAME,
                &format!("{}\n\n{error}", text(&layout, "更新未能安装，已继续启动当前版本。", "The update could not be installed. The current version will start instead.")),
                MessageLevel::Error,
            );
        }
        let result = run_portable_cli(&layout, &["start", "--no-browser", "--json"])
            .map_err(|error| error.to_string())
            .and_then(|output| output_json(&output));
        match result {
            Ok(value) => {
                if let Some(url) = value.get("url").and_then(Value::as_str) {
                    if let (Some(window), Ok(url)) =
                        (app.get_webview_window("main"), Url::parse(url))
                    {
                        let _ = window.navigate(url);
                    }
                }
                if read_shell_settings(&layout).check_updates_at_startup
                    && env::var_os("DSH_PORTABLE_SKIP_UPDATE_CHECK").is_none()
                {
                    thread::sleep(Duration::from_secs(2));
                    check_updates(app, false);
                }
            }
            Err(error) => {
                if let Some(window) = app.get_webview_window("main") {
                    let heading = serde_json::to_string(&text(
                        &layout,
                        "DeepSeek Harness 无法启动",
                        "DeepSeek Harness could not start",
                    ))
                    .unwrap_or_else(|_| "\"DeepSeek Harness could not start\"".into());
                    let encoded = serde_json::to_string(&error)
                        .unwrap_or_else(|_| "\"DSH failed to start\"".into());
                    let _ = window.eval(format!(
                        "document.querySelector('.bar').style.display='none';document.getElementById('status').textContent={heading};const e=document.getElementById('error');e.style.display='block';e.textContent={encoded};"
                    ));
                }
            }
        }
    });
}

fn run_dsh_passthrough(layout: &ProductLayout, args: &[String]) -> i32 {
    let node = layout.root.join("runtime/node/bin/node");
    let cli = layout.root.join("launcher/dsh-cli.mjs");
    match Command::new(node)
        .arg(cli)
        .args(args)
        .env("DSH_PORTABLE", "1")
        .env("DSH_PORTABLE_STATE_ROOT", &layout.state_root)
        .status()
    {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("DSH command failed: {error}");
            1
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let direct_mode = args
        .first()
        .is_some_and(|arg| arg == "dsh" || arg == "--diagnostic-root-json");
    let bundled_payload = executable_dir()
        .ok()
        .as_deref()
        .is_some_and(has_product_payload)
        || env::var_os("APPDIR").is_some();
    if direct_mode && bundled_payload {
        let layout = resolve_layout(None).expect("portable layout could not be resolved");
        if args.first().is_some_and(|arg| arg == "dsh") {
            std::process::exit(run_dsh_passthrough(&layout, &args[1..]));
        }
        if args
            .first()
            .is_some_and(|arg| arg == "--diagnostic-root-json")
        {
            println!("{}", serde_json::to_string(&layout).unwrap());
            return;
        }
    }

    tauri::Builder::default()
        .setup(move |app| {
            let resource_dir = app.path().resource_dir()?;
            let layout = resolve_layout(Some(&resource_dir))?;
            if args.first().is_some_and(|arg| arg == "dsh") {
                std::process::exit(run_dsh_passthrough(&layout, &args[1..]));
            }
            if args
                .first()
                .is_some_and(|arg| arg == "--diagnostic-root-json")
            {
                println!("{}", serde_json::to_string(&layout).unwrap());
                app.handle().exit(0);
                return Ok(());
            }
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(PRODUCT_NAME)
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 620.0)
                .center()
                .build()?;
            LAYOUT.set(layout.clone()).map_err(|_| {
                io::Error::new(io::ErrorKind::AlreadyExists, "layout already initialized")
            })?;
            setup_tray(&app.handle(), &layout)?;
            start_dsh(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("DeepSeek-Herness could not initialize")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. })
                && !QUITTING.load(Ordering::SeqCst)
            {
                stop_and_exit(app.clone());
            }
        });
}
