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
  #define AppVersion "0.2.0-rc.11"
#endif

[Setup]
AppId={{43AF08F7-927B-44F2-A2E5-5AF1BE7123ED}
AppName=DSH-Portable
AppVersion={#AppVersion}
AppPublisher=WSL043
AppPublisherURL=https://github.com/WSL043/DSH-Portable
AppSupportURL=https://github.com/WSL043/DSH-Portable/issues
DefaultDirName={src}\DSH-Portable
DisableDirPage=no
DisableProgramGroupPage=yes
UsePreviousAppDir=no
Uninstallable=no
CreateUninstallRegKey=no
OutputDir={#OutputDir}
OutputBaseFilename=DSH-Portable-windows-x64-offline
SetupIconFile={#ProjectRoot}\assets\DSH-Portable.ico
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
VersionInfoVersion=0.2.0.11
VersionInfoProductName=DSH-Portable
VersionInfoDescription=DSH-Portable offline self-extractor
VersionInfoCompany=WSL043

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
english.StartApp=Start DeepSeek-Herness
chinesesimplified.StartApp=启动 DeepSeek-Herness
english.ExistingProcessStopFailed=The existing DeepSeek-Herness process could not be stopped.
chinesesimplified.ExistingProcessStopFailed=无法停止正在运行的 DeepSeek-Herness。
english.AppStillRunning=DeepSeek-Herness is still running. Stop it before updating.
chinesesimplified.AppStillRunning=DeepSeek-Herness 仍在运行。请先退出程序再更新。

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{app}\DeepSeek-Herness.exe"; Description: "{cm:StartApp}"; Flags: nowait postinstall skipifsilent

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
