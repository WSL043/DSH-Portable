#ifndef Stage
  #error Stage is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef ProjectRoot
  #error ProjectRoot is required
#endif
#ifndef AppVersion
  #define AppVersion "0.2.6"
#endif

[Setup]
AppId={{1F096C3A-7991-4E55-B0F9-68A50B24C5A8}
AppName=DeepSeek-Herness
AppVersion={#AppVersion}
AppPublisher=WSL043
AppPublisherURL=https://github.com/WSL043/DSH-Portable
AppSupportURL=https://github.com/WSL043/DSH-Portable/issues
DefaultDirName={localappdata}\Programs\DeepSeek-Herness
DefaultGroupName=DeepSeek-Herness
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=DeepSeek-Herness-Setup
SetupIconFile={#ProjectRoot}\assets\DSH-Portable.ico
UninstallDisplayIcon={app}\DeepSeek-Herness.exe
LicenseFile={#ProjectRoot}\LICENSE
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
LanguageDetectionMethod=uilanguage
ShowLanguageDialog=auto
CloseApplications=no
RestartApplications=no
VersionInfoVersion=0.2.6.65534
VersionInfoProductName=DeepSeek-Herness
VersionInfoDescription=DeepSeek-Herness installer
VersionInfoCompany=WSL043

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
english.CreateDesktopShortcut=Create a desktop shortcut
chinesesimplified.CreateDesktopShortcut=创建桌面快捷方式
english.ShortcutGroup=Shortcuts:
chinesesimplified.ShortcutGroup=快捷方式：
english.StartApp=Start DeepSeek-Herness
chinesesimplified.StartApp=启动 DeepSeek-Herness
english.ExistingProcessStopFailed=The existing DeepSeek-Herness process could not be stopped.
chinesesimplified.ExistingProcessStopFailed=无法停止正在运行的 DeepSeek-Herness。
english.AppStillRunning=DeepSeek-Herness is still running. Stop it before updating.
chinesesimplified.AppStillRunning=DeepSeek-Herness 仍在运行。请先退出程序再更新。

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Excludes: "\data\*,\workspace\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\DeepSeek-Herness"; Filename: "{app}\DeepSeek-Herness.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeepSeek-Herness.exe"
Name: "{autodesktop}\DeepSeek-Herness"; Filename: "{app}\DeepSeek-Herness.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeepSeek-Herness.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; GroupDescription: "{cm:ShortcutGroup}"; Flags: unchecked

[Run]
Filename: "{app}\DeepSeek-Herness.exe"; Description: "{cm:StartApp}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\DeepSeek-Herness.exe"; Parameters: "stop --no-browser --json"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopDeepSeekHerness"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopEntry: String;
begin
  Result := '';
  StopEntry := ExpandConstant('{app}\DeepSeek-Herness.exe');
  if FileExists(StopEntry) then
  begin
    if not Exec(StopEntry, 'stop --no-browser --json', ExpandConstant('{app}'), SW_HIDE,
      ewWaitUntilTerminated, ResultCode) then
      Result := ExpandConstant('{cm:ExistingProcessStopFailed}')
    else if ResultCode <> 0 then
      Result := ExpandConstant('{cm:AppStillRunning}');
  end;
end;
