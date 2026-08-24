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
  #define AppVersion "0.4.9"
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
VersionInfoVersion=0.4.9.65534
VersionInfoProductName=DSH-Portable
VersionInfoDescription=DSH-Portable offline self-extractor
VersionInfoCompany=WSL043

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
english.StartApp=Start DeepSeek-Herness
chinesesimplified.StartApp=启动 DeepSeek-Herness
english.ExistingInstallBlocked=DSH-Portable already exists in:%n%n%1%n%nThis offline package only supports clean installation into an empty folder. To update while keeping sessions, settings, plugins, and workspace, run DSH-Portable-windows-x64.exe instead.
chinesesimplified.ExistingInstallBlocked=以下位置已经存在 DSH-Portable：%n%n%1%n%n离线完整包只支持安装到空目录。若要保留会话、设置、插件和工作区并升级，请改用 DSH-Portable-windows-x64.exe。
english.NonEmptyDirectoryBlocked=The target folder is not empty:%n%n%1%n%nInstallation was stopped to avoid mixing an old profile/runtime with the new package. Choose a new empty folder, or use DSH-Portable-windows-x64.exe to repair/update an existing installation.
chinesesimplified.NonEmptyDirectoryBlocked=目标文件夹不是空目录：%n%n%1%n%n为避免旧 profile/runtime 与新版本混用，安装已停止。请选择新的空目录；若要修复或升级现有安装，请改用 DSH-Portable-windows-x64.exe。

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{app}\DeepSeek-Herness.exe"; Description: "{cm:StartApp}"; Flags: nowait postinstall skipifsilent

[Code]
function DirectoryHasEntries(const Directory: String): Boolean;
var
  FindRec: TFindRec;
begin
  Result := False;
  if not DirExists(Directory) then
    Exit;

  if FindFirst(AddBackslash(Directory) + '*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then
        begin
          Result := True;
          Exit;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Target: String;
begin
  Result := '';
  Target := ExpandConstant('{app}');
  if not DirectoryHasEntries(Target) then
    Exit;

  if FileExists(AddBackslash(Target) + 'DeepSeek-Herness.exe') then
    Result := FmtMessage(ExpandConstant('{cm:ExistingInstallBlocked}'), [Target])
  else
    Result := FmtMessage(ExpandConstant('{cm:NonEmptyDirectoryBlocked}'), [Target]);
end;
