document.documentElement.classList.add("js");

const releaseBase = "https://github.com/WSL043/DSH-Portable/releases/latest/download/";

const copy = {
  en: {
    tryLink: "Try the portable workflow ↗", tryKicker: "Interactive demo / No download", tryTitle: "Try the everyday operations.", tryIntro: "Install a sample plugin, move the folder, and see what stays with you.", demoPlugins: "Plugin Market", demoMove: "Move your setup", demoInstallTitle: "Install without terminal commands.", demoInstallIntro: "Toggle a sample plugin. No plugin code is downloaded or executed here.", demoViewer: "Zoom, downloads, and region notes", demoManager: "Archive search and session restore", demoMoveTitle: "A new location. The same setup.", demoMoveIntro: "Simulates exiting and moving the folder on the same OS and architecture. External projects must be moved separately.", demoSessions: "Sample sessions: 3", demoSettings: "Model settings: kept", demoMoveButton: "Move to USB drive", demoDisclaimer: "Workflow illustration, not an online DSH instance. No model calls, file access, or data uploads. Reload to reset.",
    showcaseTitle: "Details you can see.", showcaseIntro: "Actual interface screenshots. Take a closer look before downloading.", viewerTitle: "Make your point. Precisely.", viewerText: "Zoom, original downloads, and region notes. Included by default and independently removable.", nativeTitle: "A desktop that feels familiar.", nativeText: "Sidebar controls, navigation, and keyboard shortcuts keep everyday actions close.",
    skip: "Skip to content", brandEdition: "Community portable edition", navPortable: "Portable", navDownload: "Download", navGithub: "GitHub", headerDownload: "Download",
    heroKicker: "DeepSeek Harness · continue anywhere", heroTitle: "DeepSeek Harness.<br>Ready to work.", heroLede: "DeepSeek Harness with its runtime and plugin market included. Install plugins visually and keep sessions, settings, and your default workspace together for moving and backup.",
    downloadFor: "Download for Windows", downloadMeta: "Latest stable · Portable · No install", otherPlatforms: "Other platforms", heroNote: "Open-source community project · Windows / macOS / Linux", stageCaption: "DeepSeek Harness running in DSH-Portable", scrollCue: "See how it moves",
    portableKicker: "Works where you do", portableTitle: "One folder. Same-platform moves.", portableIntro: "Work normally. When it is time to move, exit fully from the tray and copy the whole DSH-Portable folder.", migrationGuide: "Read the complete migration guide",
    factNodeValue: "No Node.js required", factLauncher: "Runtime included", factFiles: "User data and default workspace", factTargetsValue: "3 systems · 5 targets", factTargets: "Finished-product move tests",
    journeyDesktop: "Work on this computer", journeyDesktopText: "Sessions, plugins, and workspace keep saving inside the portable directory.", journeyMove: "Copy the whole directory", journeyMoveText: "Put it on a portable drive, USB drive, or any location you choose.", journeyContinue: "Continue on another computer", journeyContinueText: "Open it again and the app repairs paths it owns.",
    downloadsKicker: "Get DSH-Portable", downloadsTitle: "Choose your platform", downloadsIntro: "Your system is selected automatically. Each platform keeps a portable entry point and a complete offline package.", recommended: "Recommended",
    windowsPortable: "Windows portable", windowsPortableText: "Place the small bootstrap where you want the product; it prepares the complete folder beside itself.", downloadNow: "Download", offlineEdition: "Complete offline ZIP", offlineText: "For an offline computer or manual extraction", completeArchive: "All files", archiveText: "Release notes and other builds",
    portableZip: "Portable ZIP", portableZipText: "Extract and run. Data stays in the same directory.", linuxAppText: "Grant execute permission and run. Data stays in the adjacent directory.", completeFolder: "Complete portable directory", downloadTrust: "Windows files are currently unsigned and may trigger SmartScreen; the project is applying for open-source code signing provided by SignPath Foundation. User data stays in <code>data/</code> and the default workspace in <code>workspace/</code>. <a href=\"https://github.com/WSL043/DSH-Portable/blob/main/CODE_SIGNING.md\">Read the code-signing policy</a>.", allDownloads: "View Release", checksums: "Checksums",
    insideKicker: "Ready when opened", insideTitle: "A desktop experience without extra setup.", insideIntro: "Portable does not mean stripped down. The window, tray, notifications, plugin market, updates, and repair tools stay in the product.",
    marketTitle: "Plugin market", marketText: "Settings → Plugins → Plugin Market: search and click Install, with no terminal commands. Portable integrates upstream dsh-market.", trayTitle: "Tray and notifications", trayText: "Return to recent sessions, create a new one, and receive a notification when work completes.", repairTitle: "Check and repair", repairText: "Preserve user data, rebuild reproducible components, and export a credential-free support report.", testedTitle: "Finished-product tests", testedText: "Install, start, exit, move, plugin, and update paths are continuously verified on all three platforms.",
    faqTitle: "Common questions", faqOfficialQ: "Is this an official DeepSeek desktop app?", faqOfficialA: "No. DSH-Portable is an independent community distribution that packages a product-tested preview of official DeepSeek Harness.", faqNodeQ: "Do I need Node.js first?", faqNodeA: "No. The runtime and plugin tools are included and do not modify the system PATH.", faqDataQ: "Will copying the folder lose my sessions?", faqDataA: "Fully exit from the tray, then copy the whole DSH-Portable folder. Sessions, settings, plugins, and the default workspace move together.", faqUpdateQ: "Will an update overwrite my data?", faqUpdateA: "No. Updates replace application components while user data and workspace remain in place.",
    footerCommunity: "Independent community distribution", sourceCode: "Source code", support: "Support", community: "Discussions", privacy: "Privacy", codeSigning: "Code signing", footerLegal: "DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek."
  }
};

const zhCopy = new Map([...document.querySelectorAll("[data-i18n]")].map((element) => [element.dataset.i18n, element.innerHTML]));
const languageSwitch = document.querySelector("[data-language-switch]");
const motionControl = document.querySelector("[data-motion-control]");
const productShot = document.querySelector("[data-product-shot]");
const migrationGuide = document.querySelector("[data-migration-guide]");
const systemMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

function readSavedMotion() {
  try { return localStorage.getItem("dsh-portable-motion"); }
  catch { return null; }
}

function saveMotion(preference) {
  try { localStorage.setItem("dsh-portable-motion", preference); }
  catch { /* Storage is an enhancement, not a requirement. */ }
}

function motionEnabled() {
  return document.documentElement.dataset.motion === "full";
}

function updateMotionControlCopy() {
  const english = document.documentElement.lang.startsWith("en");
  const enabled = motionEnabled();
  motionControl.textContent = english ? `Motion ${enabled ? "on" : "off"}` : `动效${enabled ? "开" : "关"}`;
  motionControl.setAttribute("aria-label", english
    ? `${enabled ? "Disable" : "Enable"} page motion`
    : `${enabled ? "关闭" : "开启"}页面动效`);
  motionControl.setAttribute("aria-pressed", String(enabled));
}

function applyMotion(preference = "auto", persist = false) {
  const resolvedMotion = preference === "full" || (preference === "auto" && !systemMotionPreference.matches)
    ? "full"
    : "reduced";
  document.documentElement.dataset.motion = resolvedMotion;
  if (persist) saveMotion(resolvedMotion);
  updateMotionControlCopy();
  if (resolvedMotion === "reduced") {
    document.documentElement.style.setProperty("--pointer-x", "0px");
    document.documentElement.style.setProperty("--pointer-y", "0px");
    document.documentElement.style.setProperty("--stage-y", "0deg");
    document.documentElement.style.setProperty("--stage-x", "0deg");
  }
}

applyMotion(readSavedMotion() || "auto");
motionControl.addEventListener("click", () => applyMotion(motionEnabled() ? "reduced" : "full", true));
systemMotionPreference.addEventListener("change", () => {
  if (!readSavedMotion()) applyMotion("auto");
});

function primaryLabel(language, currentPlatform) {
  const labels = language === "en"
    ? { windows: "Download for Windows", macos: "Download for macOS", linux: "Download for Linux" }
    : { windows: "下载 Windows 便携版", macos: "下载 macOS 版", linux: "下载 Linux 版" };
  return labels[currentPlatform];
}

function setLanguage(language) {
  const lang = language === "en" ? "en" : "zh";
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    element.innerHTML = lang === "en" ? copy.en[key] ?? element.innerHTML : zhCopy.get(key) ?? element.innerHTML;
  });
  document.querySelector("[data-i18n='downloadFor']").textContent = primaryLabel(lang, platform);
  languageSwitch.textContent = lang === "en" ? "中" : "EN";
  languageSwitch.setAttribute("aria-label", lang === "en" ? "切换到中文" : "Switch to English");
  languageSwitch.href = lang === "en" ? "../" : "en/";
  languageSwitch.hreflang = lang === "en" ? "zh-CN" : "en";
  languageSwitch.lang = lang === "en" ? "zh-CN" : "en";
  updateMotionControlCopy();
  const assetBase = lang === "en" ? "../assets/" : "assets/";
  productShot.src = `${assetBase}${lang === "en" ? "dsh-interface-en.png" : "dsh-interface-zh.png"}`;
  productShot.alt = lang === "en" ? "DeepSeek Harness workspace in DSH-Portable" : "DSH-Portable 中的 DeepSeek Harness 桌面工作台";
  migrationGuide.href = lang === "en"
    ? "https://github.com/WSL043/DSH-Portable/blob/main/docs/move-between-computers.en.md"
    : "https://github.com/WSL043/DSH-Portable/blob/main/docs/move-between-computers.md";
}

const platformTabs = [...document.querySelectorAll("[data-platform-tab]")];
const platformPanels = [...document.querySelectorAll("[data-platform-panel]")];

function selectPlatform(selectedPlatform) {
  platformTabs.forEach((tab) => {
    const selected = tab.dataset.platformTab === selectedPlatform;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  platformPanels.forEach((panel) => { panel.hidden = panel.dataset.platformPanel !== selectedPlatform; });
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
    Object.entries(fileMap).forEach(([selector, filenames]) => { panel.querySelector(selector).href = releaseBase + filenames[architecture]; });
  };
  buttons.forEach((button) => button.addEventListener("click", () => setArchitecture(button.dataset.arch)));
  return setArchitecture;
}

const setMacArchitecture = bindArchitecture("macos", {
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
const isArm = /arm|aarch64/i.test(`${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""}`);
selectPlatform(platform);
setMacArchitecture(isArm ? "arm64" : "x64");
setLinuxArchitecture(isArm ? "arm64" : "x64");

const primaryFiles = {
  windows: "DSH-Portable-windows-x64.exe",
  macos: isArm ? "DSH-Portable-macos-arm64.zip" : "DSH-Portable-macos-x64.zip",
  linux: isArm ? "DeepSeek-Herness-linux-arm64.AppImage" : "DeepSeek-Herness-linux-x64.AppImage"
};
document.querySelectorAll("[data-primary-download]").forEach((link) => { link.href = releaseBase + primaryFiles[platform]; });

const header = document.querySelector("[data-header]");
const hero = document.querySelector("[data-hero]");
const stage = document.querySelector("[data-product-stage]");
const pathStack = document.querySelector(".path-stack");
const journey = document.querySelector("[data-journey]");
const journeySteps = [...document.querySelectorAll("[data-journey-step]")];
let ticking = false;

function updateScrollState() {
  const scrollTop = window.scrollY;
  header.classList.toggle("is-scrolled", scrollTop > 24);
  if (motionEnabled()) {
    const progress = Math.min(1, Math.max(0, scrollTop / Math.max(hero.offsetHeight, 1)));
    pathStack.style.transform = `translate3d(0, ${progress * 34}px, 0)`;
    stage.style.translate = `0 ${progress * 18}px`;
    const journeyRect = journey.getBoundingClientRect();
    const journeyProgress = Math.min(1, Math.max(0, (window.innerHeight * .78 - journeyRect.top) / (journeyRect.height + window.innerHeight * .48)));
    journey.style.setProperty("--journey-progress", journeyProgress.toFixed(3));
    journeySteps.forEach((step, index) => step.classList.toggle("is-active", journeyProgress >= index / Math.max(journeySteps.length - .35, 1)));
  }
  ticking = false;
}

window.addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(updateScrollState);
}, { passive: true });

hero.addEventListener("pointermove", (event) => {
  if (!motionEnabled() || event.pointerType === "touch") return;
  const rect = hero.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - .5;
  const y = (event.clientY - rect.top) / rect.height - .5;
  document.documentElement.style.setProperty("--pointer-x", `${x * 12}px`);
  document.documentElement.style.setProperty("--pointer-y", `${y * 8}px`);
  document.documentElement.style.setProperty("--stage-y", `${x * 2.5}deg`);
  document.documentElement.style.setProperty("--stage-x", `${y * -1.7}deg`);
});

hero.addEventListener("pointerleave", () => {
  document.documentElement.style.setProperty("--pointer-x", "0px");
  document.documentElement.style.setProperty("--pointer-y", "0px");
  document.documentElement.style.setProperty("--stage-y", "0deg");
  document.documentElement.style.setProperty("--stage-x", "0deg");
});

if ("IntersectionObserver" in window && motionEnabled()) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } });
  }, { threshold: .13 });
  document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
}

const initialLanguage = document.querySelector("meta[name='dsh-page-language']")?.content === "en" ? "en" : "zh";
setLanguage(initialLanguage);
updateScrollState();
requestAnimationFrame(() => document.documentElement.classList.add("is-ready"));

const screenshotDialog = document.querySelector('.screenshot-dialog');
document.querySelectorAll('[data-screenshot]').forEach(button => button.addEventListener('click', () => {
  const source = button.querySelector('img');
  const target = screenshotDialog.querySelector('img');
  target.src = source.src; target.alt = source.alt;
  screenshotDialog.showModal();
}));
document.querySelector('[data-close-screenshot]').addEventListener('click', () => screenshotDialog.close());
screenshotDialog.addEventListener('click', event => { if (event.target === screenshotDialog) { const r = screenshotDialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) screenshotDialog.close(); } });

const demoInstalled = new Set(['viewer']);
let demoMoved = false;
const demoEnglish = document.documentElement.lang === 'en';
const demoStatus = document.querySelector('[data-demo-status]');
function renderDemo() {
  document.querySelectorAll('[data-demo-plugin]').forEach(button => {
    const installed = demoInstalled.has(button.dataset.demoPlugin);
    button.textContent = demoEnglish ? (installed ? 'Remove' : 'Install') : (installed ? '移除' : '安装');
    button.setAttribute('aria-label', `${button.textContent} ${button.dataset.demoPlugin === 'viewer' ? 'Image Viewer' : 'Chat Manager'}`);
  });
  document.querySelector('[data-demo-count]').textContent = demoEnglish ? `Installed plugins: ${demoInstalled.size}` : `已安装插件：${demoInstalled.size}`;
  document.querySelector('[data-demo-path]').textContent = demoMoved ? 'E:/DSH-Portable' : 'C:/Work/DSH-Portable';
  document.querySelector('[data-demo-move]').textContent = demoEnglish ? (demoMoved ? 'Move back' : 'Move to USB drive') : (demoMoved ? '移回原目录' : '移动到 U 盘');
}
document.querySelectorAll('[data-demo-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-demo-tab]').forEach(tab => {
    const active = tab === button; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    document.getElementById(`demo-${tab.dataset.demoTab}`).hidden = !active;
  });
  demoStatus.textContent = '';
}));
const demoTabs = [...document.querySelectorAll('[data-demo-tab]')];
demoTabs.forEach((tab, index) => {
  tab.tabIndex = index === 0 ? 0 : -1;
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? demoTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + demoTabs.length) % demoTabs.length;
    demoTabs[next].focus(); demoTabs[next].click();
  });
});
document.querySelectorAll('[data-demo-plugin]').forEach(button => button.addEventListener('click', () => {
  const key=button.dataset.demoPlugin;
  if(demoInstalled.has(key)) demoInstalled.delete(key); else demoInstalled.add(key);
  renderDemo(); demoStatus.textContent = demoEnglish ? 'Demo state updated. Your three sample sessions are unchanged.' : '演示状态已更新，3 个示例会话保持不变。';
}));
document.querySelector('[data-demo-move]').addEventListener('click', () => {
  demoMoved = !demoMoved; renderDemo();
  demoStatus.textContent = demoEnglish ? 'Demo folder moved. Sessions, settings, and your selected plugins stayed together.' : '演示目录已移动。会话、设置及你刚选择的插件状态一起保留。';
});
renderDemo();
