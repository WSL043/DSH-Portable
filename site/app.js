const releaseBase = "https://github.com/WSL043/DSH-Portable/releases/latest/download/";

const copy = {
  en: {
    skip: "Skip to content", navDownload: "Download", navPortable: "How it works", navGithub: "GitHub",
    heroTitle: "A portable desktop build of DeepSeek Harness.",
    heroLede: "DSH-Portable keeps sessions, settings, plugins, and the default workspace in one directory. Exit, copy the folder, and continue on another computer.",
    downloadFor: "Download portable edition", otherPlatforms: "macOS and Linux downloads", heroNote: "Open-source community project · Windows / macOS / Linux",
    stageCaption: "DeepSeek Harness running in DSH-Portable",
    portableTitle: "How the portable edition works", portableIntro: "A regular install spreads application state across system directories. This edition keeps the data you need to carry inside the product folder, while retaining a desktop window, tray, and notifications.",
    folderData: "Sessions, settings, and plugins", folderWorkspace: "Default workspace", folderApp: "Desktop application",
    moveTitle: "Copy the directory to move", moveText: "Exit fully from the tray, then copy the entire folder. On the next start, the app repairs paths it owns.",
    updateTitle: "Updates leave user data alone", updateText: "Updates replace only reproducible application components. A failed startup check restores the previous version.",
    desktopTitle: "Not a browser tab", desktopText: "The desktop shell provides the window, tray, recent sessions, and task-completion notifications.",
    downloadsTitle: "Download", downloadsIntro: "Your platform is selected automatically. Other package formats remain available below it.",
    windowsPortable: "Windows portable", windowsPortableText: "Download the small bootstrap, choose a location, and it prepares the complete folder.", downloadNow: "Download",
    offlineEdition: "Complete offline ZIP", offlineText: "For an offline computer or manual extraction", installerEdition: "Installer", installerText: "Start menu, shortcuts, and standard uninstall", completeArchive: "All files", archiveText: "Release notes and other builds",
    macDmg: "macOS DMG", macDmgText: "Drag it into Applications. The current build is not Apple-notarized.", portableZip: "Portable ZIP", portableZipText: "Extract and run",
    linuxAppText: "Grant execute permission and run. Data is stored in the adjacent folder.", completeFolder: "Complete portable folder", allDownloads: "View Release", checksums: "Checksums",
    insideTitle: "Included features",
    marketTitle: "Plugin market", marketText: "Browse, install, update, and disable community plugins from DSH Settings.",
    trayTitle: "Tray and notifications", trayText: "Return to recent sessions, create a new one, and receive a notification when work completes.",
    repairTitle: "Check and repair", repairText: "Preserve user data, rebuild reproducible components, and export a credential-free support report.",
    testedTitle: "Product tests", testedText: "Install, start, exit, move, plugin, and update paths are continuously tested on all three platforms.",
    faqTitle: "Common questions", faqOfficialQ: "Is this an official DeepSeek desktop app?", faqOfficialA: "No. DSH-Portable is an independent community distribution that packages a product-tested preview of official DeepSeek Harness.",
    faqNodeQ: "Do I need Node.js first?", faqNodeA: "No. The runtime and plugin tools are included and do not modify the system PATH.",
    faqDataQ: "Will copying the folder lose my sessions?", faqDataA: "Fully exit from the tray, then copy the whole DSH-Portable folder. Sessions, settings, plugins, and the default workspace move together.",
    faqUpdateQ: "Will an update overwrite my data?", faqUpdateA: "No. Updates replace application components while user data and workspace remain in place.",
    footerCommunity: "Independent community distribution", sourceCode: "Source code", support: "Support", community: "Discussions",
    footerLegal: "DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek."
  }
};

const zhCopy = new Map([...document.querySelectorAll("[data-i18n]")].map((element) => [element.dataset.i18n, element.innerHTML]));
const languageSwitch = document.querySelector("[data-language-switch]");
const productShot = document.querySelector("[data-product-shot]");

function readSavedLanguage() {
  try { return localStorage.getItem("dsh-portable-language"); }
  catch { return null; }
}

function saveLanguage(language) {
  try { localStorage.setItem("dsh-portable-language", language); }
  catch { /* The site remains fully usable when storage is unavailable. */ }
}

function setLanguage(language) {
  const lang = language === "en" ? "en" : "zh";
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    element.innerHTML = lang === "en" ? copy.en[key] ?? element.innerHTML : zhCopy.get(key) ?? element.innerHTML;
  });
  languageSwitch.textContent = lang === "en" ? "中" : "EN";
  languageSwitch.setAttribute("aria-label", lang === "en" ? "切换到中文" : "Switch to English");
  productShot.src = lang === "en" ? "assets/dsh-interface-en.png" : "assets/dsh-interface-zh.png";
  productShot.alt = lang === "en" ? "DeepSeek Harness workspace in DSH-Portable" : "DSH-Portable 中的 DeepSeek Harness 桌面工作台";
  saveLanguage(lang);
}

languageSwitch.addEventListener("click", () => setLanguage(document.documentElement.lang.startsWith("en") ? "zh" : "en"));

const platformTabs = [...document.querySelectorAll("[data-platform-tab]")];
const platformPanels = [...document.querySelectorAll("[data-platform-panel]")];

function selectPlatform(platform) {
  platformTabs.forEach((tab) => {
    const selected = tab.dataset.platformTab === platform;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  platformPanels.forEach((panel) => { panel.hidden = panel.dataset.platformPanel !== platform; });
}

platformTabs.forEach((tab) => tab.addEventListener("click", () => selectPlatform(tab.dataset.platformTab)));
platformTabs.forEach((tab, index) => tab.addEventListener("keydown", (event) => {
  let nextIndex = null;
  if (event.key === "ArrowRight") nextIndex = (index + 1) % platformTabs.length;
  if (event.key === "ArrowLeft") nextIndex = (index - 1 + platformTabs.length) % platformTabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = platformTabs.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  platformTabs[nextIndex].focus();
  selectPlatform(platformTabs[nextIndex].dataset.platformTab);
}));

function bindArchitecture(panelName, fileMap) {
  const panel = document.querySelector(`[data-platform-panel="${panelName}"]`);
  const buttons = [...panel.querySelectorAll("[data-arch]")];
  const setArchitecture = (architecture) => {
    buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.arch === architecture));
    Object.entries(fileMap).forEach(([selector, filenames]) => {
      panel.querySelector(selector).href = releaseBase + filenames[architecture];
    });
  };
  buttons.forEach((button) => button.addEventListener("click", () => setArchitecture(button.dataset.arch)));
  return setArchitecture;
}

const setMacArchitecture = bindArchitecture("macos", {
  "[data-mac-download='dmg']": { arm64: "DeepSeek-Herness-macos-arm64.dmg", x64: "DeepSeek-Herness-macos-x64.dmg" },
  "[data-mac-download='zip']": { arm64: "DSH-Portable-macos-arm64.zip", x64: "DSH-Portable-macos-x64.zip" }
});
const setLinuxArchitecture = bindArchitecture("linux", {
  "[data-linux-download='appimage']": { x64: "DeepSeek-Herness-linux-x64.AppImage", arm64: "DeepSeek-Herness-linux-arm64.AppImage" },
  "[data-linux-download='archive']": { x64: "DSH-Portable-linux-x64.tar.gz", arm64: "DSH-Portable-linux-arm64.tar.gz" }
});

function detectedPlatform() {
  const value = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("linux") || value.includes("x11")) return "linux";
  return "windows";
}

const platform = detectedPlatform();
selectPlatform(platform);
const isArm = /arm|aarch64/i.test(`${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""}`);
setMacArchitecture(platform === "macos" || isArm ? "arm64" : "x64");
setLinuxArchitecture(isArm ? "arm64" : "x64");

const primaryFiles = {
  windows: "DSH-Portable-windows-x64.exe",
  macos: platform === "macos" || isArm ? "DeepSeek-Herness-macos-arm64.dmg" : "DeepSeek-Herness-macos-x64.dmg",
  linux: isArm ? "DeepSeek-Herness-linux-arm64.AppImage" : "DeepSeek-Herness-linux-x64.AppImage"
};
document.querySelectorAll("[data-primary-download]").forEach((link) => { link.href = releaseBase + primaryFiles[platform]; });

const initialLanguage = readSavedLanguage() || (navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en");
setLanguage(initialLanguage);
