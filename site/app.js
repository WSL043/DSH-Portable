const releaseBase =
  "https://github.com/WSL043/DSH-Portable/releases/latest/download/";
const copy = {
  en: {
    guidesTitle: "Start with your question.",
    guideStart: "How do I start without runtime setup?",
    guideStartText: "Download, connect a model, and install plugins visually. Guide in Chinese.",
    guideMove: "What happens to my sessions when I move?",
    guideMoveText: "Same-platform migration and backup: what to take with you. Guide in Chinese.",
    starProject: "☆ Star",
    starInvite: "Find it useful? Star the project on GitHub, or share it with someone who needs a portable DSH workspace.",
    starAction: "Star on GitHub ↗",
    viewerTitle: "Give details a closer look.",
    viewerText:
      "Zoom in, download originals, and leave region notes. Image Viewer is included by default and can be removed independently.",
    nativeTitle: "Familiar controls. Consistent details.",
    nativeText:
      "Sidebar controls, back and forward, and keyboard shortcuts. Light or dark, the way you prefer.",
    skip: "Skip to content",
    navPortable: "Portable",
    navDownload: "Download",
    heroTitle: "Your workspace.<br>Where you go.",
    heroLede:
      "Runtime and plugin market, ready to use.<br>Sessions, settings, and your default workspace stay in your own folder.",
    downloadFor: "Download for Windows",
    otherPlatforms: "Other platforms",
    heroNote: "No runtime setup / Visual plugins / Independent kernel updates",
    stageCaption: "One folder. Your complete working environment.",
    portableTitle: "A new location.<br>The same workspace.",
    portableIntro:
      "No runtime to reinstall. No sessions to hunt down. Exit fully, copy the whole folder, and continue on a computer with the same OS and architecture.",
    migrationGuide: "Read the migration guide ↗",
    factNodeValue: "No Node.js required",
    factLauncher: "Runtime included. No system environment to configure.",
    factFiles:
      "Sessions, settings, and your default workspace stay in the portable directory.",
    downloadsKicker: "Get DSH-Portable",
    downloadsTitle: "Choose your platform",
    downloadsIntro:
      "Choose your operating system and architecture. Downloads are hosted on GitHub Releases.",
    recommended: "Recommended",
    windowsPortable: "Windows portable",
    windowsPortableText:
      "Place the small bootstrap where you want the product; it prepares the complete folder beside itself.",
    downloadNow: "Download",
    offlineEdition: "Complete offline ZIP",
    offlineText: "For an offline computer or manual extraction",
    completeArchive: "All files",
    archiveText: "Release notes and other builds",
    portableZip: "Portable ZIP",
    portableZipText: "Extract and run. Data stays in the same directory.",
    linuxAppText:
      "Grant execute permission and run. Data stays in the adjacent directory.",
    completeFolder: "Complete portable directory",
    downloadTrust:
      'Windows files are currently unsigned and may trigger SmartScreen; the project is applying for open-source code signing provided by SignPath Foundation. User data stays in <code>data/</code> and the default workspace in <code>workspace/</code>. <a href="https://github.com/WSL043/DSH-Portable/blob/main/CODE_SIGNING.md">Read the code-signing policy</a>.',
    allDownloads: "View Release",
    checksums: "Checksums",
    marketText:
      "Settings → Plugins → Plugin Market. Search, install, and manage visually. Portable integrates upstream dsh-market, with no install commands to type.",
    repairTitle: "A clearer path to diagnosis.",
    repairText:
      "Startup records and support reports help trace problems. Repair tools rebuild reproducible components while keeping user data.",
    faqTitle: "Common questions",
    faqOfficialQ: "Is this an official DeepSeek desktop app?",
    faqOfficialA:
      "No. DSH-Portable is an independent community distribution that packages a product-tested preview of official DeepSeek Harness.",
    faqNodeQ: "Do I need Node.js first?",
    faqNodeA:
      "No. The runtime and plugin tools are included and do not modify the system PATH.",
    faqDataQ: "Will copying the folder lose my sessions?",
    faqDataA:
      "Fully exit from the tray, then copy the whole DSH-Portable folder. Sessions, settings, plugins, and the default workspace move together.",
    faqUpdateQ: "Will an update overwrite my data?",
    faqUpdateA:
      "No. Updates replace application components while user data and workspace remain in place.",
    footerCommunity: "Independent community distribution",
    sourceCode: "Source code",
    support: "Support",
    community: "Discussions",
    privacy: "Privacy",
    codeSigning: "Code signing",
    footerLegal:
      "DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek.",
    navPlugins: "Plugins",
    stageBoundary: "Independent community edition · Same-platform moves",
    sceneHint: "Actual interface captures · Hover to change the viewing angle",
    followSystem: "Use system appearance",
    folderRuntime: "The bundled runtime",
    folderData: "Sessions, settings, and plugins",
    folderWorkspace: "Your default workspace",
    folderFoot: "Your work stays where you choose.",
    factFilesTitle: "Move and back up together",
    factBoundaryTitle: "Know what moves with you",
    factBoundary:
      "Move external projects separately. Read the migration guide before changing OS or architecture.",
    pluginsTitle: "The tools you want.<br>Installed right here.",
    managerText:
      "Organize and find sessions to pick up earlier work. Both default plugins are maintained and updated independently.",
    desktopTitle: "From the first launch to every day.",
    desktopIntro:
      "Desktop controls, keyboard navigation, and update management complete the portable experience.",
    shortcutSidebar: "Sidebar",
    shortcutFullscreen: "Full screen",
    updateTitle: "The shell and kernel update separately.",
    updateText:
      "Choose Portable and compatible kernel versions in update settings. Use stable or preview releases at your own pace.",
  },
};

const zhCopy = new Map(
  [...document.querySelectorAll("[data-i18n]")].map((element) => [
    element.dataset.i18n,
    element.innerHTML,
  ]),
);
const languageSwitch = document.querySelector("[data-language-switch]");
const motionControl = document.querySelector("[data-motion-control]");
const productShot = document.querySelector("[data-product-shot]");
const migrationGuide = document.querySelector("[data-migration-guide]");
const systemMotionPreference = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

function readSavedMotion() {
  try {
    return localStorage.getItem("dsh-portable-motion");
  } catch {
    return null;
  }
}

function saveMotion(preference) {
  try {
    localStorage.setItem("dsh-portable-motion", preference);
  } catch {
    /* Storage is an enhancement, not a requirement. */
  }
}

function motionEnabled() {
  return document.documentElement.dataset.motion === "full";
}

function updateMotionControlCopy() {
  const english = document.documentElement.lang.startsWith("en");
  const enabled = motionEnabled();
  motionControl.textContent = english
    ? `Motion ${enabled ? "on" : "off"}`
    : `动效${enabled ? "开" : "关"}`;
  motionControl.setAttribute(
    "aria-label",
    english
      ? `${enabled ? "Disable" : "Enable"} page motion`
      : `${enabled ? "关闭" : "开启"}页面动效`,
  );
  motionControl.setAttribute("aria-pressed", String(enabled));
}

function applyMotion(preference = "auto", persist = false) {
  const resolvedMotion =
    preference === "full" ||
    (preference === "auto" && !systemMotionPreference.matches)
      ? "full"
      : "reduced";
  document.documentElement.dataset.motion = resolvedMotion;
  if (persist) saveMotion(resolvedMotion);
  updateMotionControlCopy();
}

applyMotion(readSavedMotion() || "auto");
motionControl.addEventListener("click", () =>
  applyMotion(motionEnabled() ? "reduced" : "full", true),
);
systemMotionPreference.addEventListener("change", () => {
  if (!readSavedMotion()) applyMotion("auto");
});

function primaryLabel(language, currentPlatform) {
  const labels =
    language === "en"
      ? {
          windows: "Download for Windows",
          macos: "Download for macOS",
          linux: "Download for Linux",
        }
      : {
          windows: "下载 Windows 便携版",
          macos: "下载 macOS 版",
          linux: "下载 Linux 版",
        };
  return labels[currentPlatform];
}

function setLanguage(language) {
  const lang = language === "en" ? "en" : "zh";
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    element.innerHTML =
      lang === "en"
        ? (copy.en[key] ?? element.innerHTML)
        : (zhCopy.get(key) ?? element.innerHTML);
  });
  document.querySelector("[data-i18n='downloadFor']").textContent =
    primaryLabel(lang, platform);
  languageSwitch.textContent = lang === "en" ? "中" : "EN";
  languageSwitch.setAttribute(
    "aria-label",
    lang === "en" ? "切换到中文" : "Switch to English",
  );
  languageSwitch.href = lang === "en" ? "../" : "en/";
  languageSwitch.hreflang = lang === "en" ? "zh-CN" : "en";
  languageSwitch.lang = lang === "en" ? "zh-CN" : "en";
  updateMotionControlCopy();
  const assetBase = lang === "en" ? "../assets/" : "assets/";
  productShot.src = `${assetBase}${lang === "en" ? "dsh-interface-en.png" : "dsh-interface-zh.png"}`;
  productShot.alt =
    lang === "en"
      ? "DeepSeek Harness workspace in DSH-Portable"
      : "DSH-Portable 中的 DeepSeek Harness 桌面工作台";
  migrationGuide.href =
    lang === "en"
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
  platformPanels.forEach((panel) => {
    panel.hidden = panel.dataset.platformPanel !== selectedPlatform;
  });
}

platformTabs.forEach((tab) =>
  tab.addEventListener("click", () => selectPlatform(tab.dataset.platformTab)),
);
platformTabs.forEach((tab, index) =>
  tab.addEventListener("keydown", (event) => {
    let nextIndex = null;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % platformTabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + platformTabs.length) % platformTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = platformTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    platformTabs[nextIndex].focus();
    selectPlatform(platformTabs[nextIndex].dataset.platformTab);
  }),
);

function bindArchitecture(panelName, fileMap) {
  const panel = document.querySelector(`[data-platform-panel="${panelName}"]`);
  const buttons = [...panel.querySelectorAll("[data-arch]")];
  const setArchitecture = (architecture) => {
    buttons.forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.arch === architecture,
      );
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.arch === architecture),
      );
    });
    Object.entries(fileMap).forEach(([selector, filenames]) => {
      panel.querySelector(selector).href =
        releaseBase + filenames[architecture];
    });
  };
  buttons.forEach((button) =>
    button.addEventListener("click", () =>
      setArchitecture(button.dataset.arch),
    ),
  );
  return setArchitecture;
}

const setMacArchitecture = bindArchitecture("macos", {
  "[data-mac-download='zip']": {
    arm64: "DSH-Portable-macos-arm64.zip",
    x64: "DSH-Portable-macos-x64.zip",
  },
});
const setLinuxArchitecture = bindArchitecture("linux", {
  "[data-linux-download='appimage']": {
    x64: "DeepSeek-Herness-linux-x64.AppImage",
    arm64: "DeepSeek-Herness-linux-arm64.AppImage",
  },
  "[data-linux-download='archive']": {
    x64: "DSH-Portable-linux-x64.tar.gz",
    arm64: "DSH-Portable-linux-arm64.tar.gz",
  },
});

function detectedPlatform() {
  const value =
    `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("linux") || value.includes("x11")) return "linux";
  return "windows";
}

const platform = detectedPlatform();
const isArm = /arm|aarch64/i.test(
  `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""}`,
);
selectPlatform(platform);
setMacArchitecture("arm64");
setLinuxArchitecture(isArm ? "arm64" : "x64");

const primaryFiles = {
  windows: "DSH-Portable-windows-x64.exe",
  macos: "DSH-Portable-macos-arm64.zip",
  linux: isArm
    ? "DeepSeek-Herness-linux-arm64.AppImage"
    : "DeepSeek-Herness-linux-x64.AppImage",
};
document.querySelectorAll("[data-primary-download]").forEach((link) => {
  link.href =
    platform === "macos" ? "#downloads" : releaseBase + primaryFiles[platform];
});

const initialLanguage =
  document.querySelector("meta[name='dsh-page-language']")?.content === "en"
    ? "en"
    : "zh";
setLanguage(initialLanguage);
const themeToggle = document.querySelector(".theme-toggle");
const systemTheme = matchMedia("(prefers-color-scheme: light)");
let themeMode = "system";
try {
  themeMode = localStorage.getItem("dsh-portable-theme") || "system";
} catch {}
if (!["light", "dark", "system"].includes(themeMode)) themeMode = "system";
function applyTheme(save = false) {
  const light =
    themeMode === "light" || (themeMode === "system" && systemTheme.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  const english = initialLanguage === "en";
  themeToggle.querySelector(".theme-icon").textContent = light ? "☾" : "☼";
  themeToggle.querySelector(".theme-label").textContent = english
    ? light
      ? "Dark"
      : "Light"
    : light
      ? "暗色"
      : "亮色";
  themeToggle.setAttribute(
    "aria-label",
    english
      ? light
        ? "Switch to dark mode"
        : "Switch to light mode"
      : light
        ? "切换到暗色"
        : "切换到亮色",
  );
  themeToggle.setAttribute("aria-pressed", String(light));
  document
    .querySelector("#follow-system")
    .setAttribute("aria-pressed", String(themeMode === "system"));
  document.querySelector('meta[name="theme-color"]').content = light
    ? "#f7f7f5"
    : "#101010";
  if (save)
    try {
      localStorage.setItem("dsh-portable-theme", themeMode);
    } catch {}
}
themeToggle.addEventListener("click", () => {
  themeMode =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(true);
});
document.querySelector("#follow-system").addEventListener("click", () => {
  themeMode = "system";
  applyTheme(true);
});
systemTheme.addEventListener("change", () => {
  if (themeMode === "system") applyTheme();
});
applyTheme();
requestAnimationFrame(() =>
  requestAnimationFrame(() =>
    document.documentElement.classList.add("theme-ready"),
  ),
);

const screenshotDialog = document.querySelector(".screenshot-dialog");
document.querySelectorAll("[data-screenshot]").forEach((button) =>
  button.addEventListener("click", () => {
    const source = button.querySelector("img");
    const target = screenshotDialog.querySelector("img");
    target.src = source.src;
    target.alt = source.alt;
    screenshotDialog.showModal();
  }),
);
document
  .querySelector("[data-close-screenshot]")
  .addEventListener("click", () => screenshotDialog.close());
screenshotDialog.addEventListener("click", (event) => {
  if (event.target !== screenshotDialog) return;
  const r = screenshotDialog.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    screenshotDialog.close();
});
// The readable page and real screenshots remain available if WebGL or its module fails.
import("./scene.js").catch(() =>
  document.querySelector("[data-hero]").classList.add("scene-unavailable"),
);
