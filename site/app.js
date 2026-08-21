const releaseBase = "https://github.com/WSL043/DSH-Portable/releases/latest/download/";

const copy = {
  en: {
    skip: "Skip to content", navDownload: "Download", navPortable: "Why portable", navGithub: "GitHub",
    heroEyebrow: "Community desktop distribution for DeepSeek Harness",
    heroTitle: "Take your entire DSH workspace to the next computer.",
    heroLede: "Sessions, settings, plugins, and workspace stay together. Copy one folder and continue on another drive, USB device, or computer.",
    downloadFor: "Download recommended edition", otherPlatforms: "Other platforms", heroNote: "Free and open source · Windows, macOS, Linux · Your data stays yours",
    stageCaption: "A dedicated window. Background tasks keep running.",
    proofOneTitle: "One folder", proofOneText: "Your complete environment", proofTwoTitle: "Three platforms",
    proofThreeTitle: "Direct updates", proofThreeText: "Your data stays in place", proofFourTitle: "Native plugin market", proofFourText: "Discover, install, manage",
    portableEyebrow: "Made to move", portableTitle: "Not a web page inside a window.<br>Your working state, inside your folder.",
    folderMoves: "Move the entire folder", folderData: "Sessions, settings, plugins", folderWorkspace: "Default workspace", folderApp: "Desktop entry point",
    moveTitle: "Move, then continue", moveText: "Exit the app and copy the whole directory. Managed paths repair themselves; external projects stay where you left them.",
    updateTitle: "Update the app, not your data", updateText: "Finished-product updates preserve sessions, credentials, plugins, and workspace, with rollback if startup fails.",
    desktopTitle: "A desktop app where it matters", desktopText: "Dedicated window, system tray, task notifications, and recent sessions. Close the window while a task keeps running.",
    downloadsEyebrow: "Choose your edition", downloadsTitle: "Download it. Start from here.", downloadsIntro: "We selected your system. Switch platform or choose another installation mode whenever you need.",
    recommended: "RECOMMENDED", windowsPortable: "Windows portable", windowsPortableText: "A 55 KB launcher. First run prepares a complete, movable workspace beside it.", downloadNow: "Download now",
    offlineEdition: "Complete offline ZIP", offlineText: "For an offline destination computer or manual extraction", installerEdition: "Installer", installerText: "Start menu, shortcuts, and standard uninstall", completeArchive: "All release files", archiveText: "Release notes and other platforms",
    macDmg: "macOS disk image", macDmgText: "Drag into Applications. The current build is ad-hoc signed, so first launch may ask for confirmation.", portableZip: "Portable ZIP", portableZipText: "Extract and run; made to move with its folder",
    linuxAppText: "Grant execute permission once. Portable data lives in the sibling directory.", completeFolder: "Complete portable folder", allDownloads: "All downloads and release notes ↗", checksums: "Checksums",
    insideEyebrow: "More than a launcher", insideTitle: "The parts you need every day, brought together.",
    marketTitle: "Plugin market", marketText: "Discover, install, update, or disable community plugins from Settings, in the current DSH language and theme.",
    trayTitle: "Tray and notifications", trayText: "Return to recent sessions, start a new one, and receive a system notification when work is complete.",
    repairTitle: "Check and repair", repairText: "Keep user data, rebuild reproducible components, and export a support report without credentials.",
    testedTitle: "Finished-product validation", testedText: "Install, start, exit, move, and update paths are tested across Windows, macOS, and Linux.",
    faqTitle: "A few things before you begin.", faqOfficialQ: "Is this an official DeepSeek desktop app?", faqOfficialA: "No. DSH-Portable is an independent community distribution that packages a tested preview of official DeepSeek Harness.",
    faqNodeQ: "Do I need to install Node.js first?", faqNodeA: "No. The runtime and plugin tools are included and do not modify your system Node.js or PATH.",
    faqDataQ: "Will copying the folder lose my sessions?", faqDataA: "Fully exit from the tray, then copy the whole DSH-Portable folder. Sessions, settings, plugins, and the default workspace move together.",
    faqUpdateQ: "Will an update overwrite my data?", faqUpdateA: "No. Updates replace reproducible app components and preserve data and workspace. A failed start rolls back to the previous version.",
    closingTitle: "Take your workspace with you.", closingText: "Start with one folder. Work wherever you need to.", downloadPortable: "Download portable",
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
