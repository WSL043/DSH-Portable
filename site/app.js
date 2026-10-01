const releaseBase =
  "https://github.com/WSL043/DSH-Portable/releases/latest/download/";
const copy = {
  en: {
    guidesTitle: "Start with your question.",
    guideStart: "How do I start with the portable edition?",
    guideStartText: "Choose a download, connect a model service, and manage plugins as needed. Guide in Chinese.",
    guideMove: "What happens to my sessions when I move?",
    guideMoveText: "Same-platform migration and backup: what to take with you. Guide in Chinese.",
    starProject: "GitHub ↗",
    starInvite: "Find it useful? Use the Star button at the top right of the GitHub repository, or share it with someone who needs a portable DSH workspace.",
    starAction: "View on GitHub ↗",
    viewerTitle: "Give details a closer look.",
    viewerText:
      "Zoom in, download originals, and leave region notes. Image Viewer is included by default and can be removed independently.",
    nativeTitle: "Familiar controls. Consistent details.",
    nativeText:
      "Sidebar controls, back and forward, and keyboard shortcuts. Light or dark, the way you prefer.",
    skip: "Skip to content",
    navPortable: "Portable",
    navChoice: "Which to choose",
    navDownload: "Download",
    heroTitle: "DeepSeek Harness<br>in a portable folder.",
    heroLede:
      "One folder for your sessions, settings, plugins, and workspace.<br>Move it on the same platform; update Portable and core separately.",
    downloadFor: "Download for Windows",
    otherPlatforms: "Other platforms",
    heroNote: "No installation or PATH changes / Copy the folder on the same platform / Data-preserving rollback and recovery",
    stageCaption: "Sessions, settings, plugins, and workspace in one folder.",
    portableTitle: "One folder.<br>Pick up where you left off.",
    portableIntro:
      "Sessions, settings, plugins, and the default workspace stay together. Fully exit, then copy the folder to a USB drive or another computer with the same OS and architecture.",
    migrationGuide: "Read the migration guide ↗",
    factNodeValue: "One folder",
    factLauncher:
      "Sessions, settings, plugins, and the default workspace stay together in the portable directory.",
    factFiles:
      "After fully exiting, copy the whole folder to a USB drive or a computer with the same OS and architecture.",
    downloadsKicker: "Get DSH-Portable",
    downloadsTitle: "Choose your platform",
    downloadsIntro:
      "Choose your operating system and architecture. Downloads are hosted on GitHub Releases.",
    recommended: "Recommended",
    windowsPortable: "Windows portable",
    windowsPortableText:
      "Place the small bootstrap where you want the product; it prepares the complete folder beside itself.",
    downloadNow: "Download",
    offlineEdition: "Standard ZIP",
    offlineText: "Download and extract it yourself",
    completeOfflineArchive: "Complete offline ZIP",
    completeOfflineText: "For a target without WebView2 that cannot install it online",
    completeArchive: "All files",
    archiveText: "Release notes and other builds",
    portableZip: "Portable ZIP",
    portableZipText: "Extract and run. Data stays in the same directory.",
    linuxAppText:
      "Grant execute permission and run. Data stays in the adjacent directory.",
    completeFolder: "Complete portable directory",
    downloadTrust:
      'Windows files are not digitally signed and may trigger SmartScreen or a Windows Security false positive; download only from GitHub Releases, compare the checksums, and see the <a href=\"https://github.com/WSL043/DSH-Portable/blob/main/docs/user-guide.en.md#windows-security-removed-the-program-or-blocked-it\">user guide</a> if a file is removed. User data stays in <code>data/</code> and the default workspace in <code>workspace/</code>. <a href="https://github.com/WSL043/DSH-Portable/blob/main/CODE_SIGNING.md">Read the code-signing policy</a>.',
    allDownloads: "View Release",
    checksums: "Checksums",
    marketText:
      "Use DSH plugin management to search, install, or update from Settings → Plugins → Plugin Market. Plugin state stays with the portable folder.",
    repairTitle: "A clearer path to diagnosis.",
    repairText:
      "Startup records and support reports help trace problems. Repair tools rebuild reproducible components while keeping user data.",
    faqTitle: "Common questions",
    faqOfficialQ: "Is this an official DeepSeek desktop app?",
    faqOfficialA:
      'No. DSH-Portable is an independent community project, not an official DeepSeek app, and is not endorsed by DeepSeek. The official desktop app is installer-based; <a href="https://www.deepseek.com/harness/">see the official desktop app</a>.',
    faqNodeQ: "Do I need to install Node.js separately to use a portable package?",
    faqNodeA:
      "No separate Node.js installation is needed to use a packaged stable 0.x build. That is a runtime fact, not the main difference from the official installer.",
    faqDataQ: "Will copying the folder lose my sessions?",
    faqDataA:
      "Fully exit, then copy the whole folder to a USB drive or a computer with the same OS and architecture. Sessions, settings, plugins, and the default workspace move together.",
    faqUpdateQ: "Will an update overwrite my data?",
    faqUpdateA:
      "Portable and core update separately, and you can choose a core version. Updates keep user data and the workspace in place; data-preserving rollback and recovery tools are included.",
    footerCommunity: "Independent community distribution",
    sourceCode: "Source code",
    support: "Support",
    community: "Discussions",
    privacy: "Privacy",
    codeSigning: "Code signing",
    footerLegal:
      "DeepSeek Harness, the DeepSeek name, and its marks belong to DeepSeek. DSH-Portable is independently maintained by WSL043 and is not endorsed by DeepSeek.",
    navPlugins: "Plugins",
    stageBoundary: "Independent community project · Same-platform moves",
    sceneHint: "Actual interface captures · Hover to change the viewing angle",
    followSystem: "Use system appearance",
    folderRuntime: "Program components and runtime",
    folderData: "Sessions, settings, and plugins",
    folderWorkspace: "Your default workspace",
    folderFoot: "Your work stays where you choose.",
    factFilesTitle: "Move and resume",
    factBoundaryTitle: "Updates keep your data",
    factBoundary:
      "Portable and core update separately, with core-version choice; user data and workspace remain in place.",
    factRecoveryTitle: "Recovery when needed",
    factRecovery:
      "Rollback, checks, targeted repair, and recovery tools help fix issues while preserving personal data.",
    choiceTitle: "Official desktop or portable?",
    choiceIntro:
      "Each delivery model has a different focus. Choose based on installation preferences, number of devices, and update control.",
    choiceOfficialLabel: "OFFICIAL DESKTOP",
    choiceOfficialTitle: "DeepSeek official desktop app",
    choiceOfficialInstall: "Installer-based, available for Windows and macOS.",
    choiceOfficialUpdates: "Follows the official release schedule.",
    choiceOfficialFit: "A good fit if you want an installed app on one computer.",
    officialDesktopLink: "Explore the official desktop app ↗",
    choicePortableLabel: "DSH-PORTABLE",
    choicePortableTitle: "The portable edition of DeepSeek Harness",
    choicePortableInstall:
      "Stable 0.x supports Windows, macOS, and Linux, without installation or PATH changes.",
    choicePortableUpdates:
      "Portable and core update separately, with core-version choice.",
    choicePortableMove:
      "After fully exiting, copy the folder to a USB drive or a computer on the same platform.",
    choicePortableFit:
      "A good fit if you want to carry it between devices or control update timing.",
    portableDownloadsLink: "View stable downloads ↗",
    projectBoundary:
      "DSH-Portable is an independent community project, not an official DeepSeek app, and is not endorsed by DeepSeek.",
    linesTitle: "Two product lines",
    linesIntro:
      "Choose the stable line for everyday use. The development line is separate from public downloads.",
    stableLineLabel: "CURRENT DOWNLOAD",
    stableLineTitle: "Stable 0.x (Native)",
    stableLineText:
      "The current public download, supporting Windows, macOS, and Linux.",
    developmentLineLabel: "ALPHA PREVIEW",
    developmentLineTitle: "1.0 line",
    developmentLineText:
      'Runs the official desktop app itself and only moves its data into the folder: sessions, settings, plugins, and sign-in travel together, and new official releases install from the app\'s own "Install and Restart". Windows only; an alpha preview you can try from <a href="https://github.com/WSL043/DSH-Portable/releases/tag/v1.0.0-alpha.4">Releases</a>; it is not an upgrade path from 0.x. <a href="../guides/official-desktop-portable.html">Read about the 1.0 preview</a>',
    pluginsTitle: "Plugin tools,<br>kept in your folder.",
    managerText:
      "Organize and find sessions to pick up earlier work. Both default plugins are maintained and updated independently.",
    desktopTitle: "Controlled updates. Your data stays put.",
    desktopIntro:
      "Portable and core can update separately, with compatible core versions to choose from. Rollback and recovery tools help preserve personal data.",
    shortcutSidebar: "Sidebar",
    shortcutFullscreen: "Full screen",
    updateTitle: "Portable and core update separately.",
    updateText:
      "Choose a compatible core version in update settings. Data-preserving rollback and recovery tools keep your work in place.",
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
