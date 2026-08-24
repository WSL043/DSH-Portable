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
  #define AppVersion "0.4.8"
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
CloseApplications=yes
RestartApplications=no
ChangesEnvironment=yes
VersionInfoVersion=0.4.8.65534
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
english.AddToUserPath=Use dsh commands in PowerShell and Command Prompt
chinesesimplified.AddToUserPath=在 PowerShell 和命令提示符中使用 dsh 命令
english.CommandLineGroup=Command line:
chinesesimplified.CommandLineGroup=命令行：
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
Name: "addtopath"; Description: "{cm:AddToUserPath}"; GroupDescription: "{cm:CommandLineGroup}"

[Run]
Filename: "{app}\DeepSeek-Herness.exe"; Description: "{cm:StartApp}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\DeepSeek-Herness.exe"; Parameters: "stop --no-browser --json"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopDeepSeekHerness"

[Code]
const
  UserEnvironmentKey = 'Environment';
  CommandOwnershipKey = 'Software\WSL043\DSH-Portable';
  CommandOwnershipValue = 'InstalledCommandPath';

function NormalizePathEntry(Value: String): String;
begin
  Result := Trim(Value);
  if (Length(Result) >= 2) and (Result[1] = '"') and
    (Result[Length(Result)] = '"') then
    Result := Copy(Result, 2, Length(Result) - 2);
  while (Length(Result) > 3) and
    ((Result[Length(Result)] = '\') or (Result[Length(Result)] = '/')) do
    Delete(Result, Length(Result), 1);
end;

function SamePathEntry(LeftValue, RightValue: String): Boolean;
begin
  Result := CompareText(NormalizePathEntry(LeftValue),
    NormalizePathEntry(RightValue)) = 0;
end;

function PathWithoutEntry(PathValue, Target: String): String;
var
  Remaining: String;
  Entry: String;
  Separator: Integer;
begin
  Result := '';
  Remaining := PathValue;
  while Remaining <> '' do
  begin
    Separator := Pos(';', Remaining);
    if Separator = 0 then
    begin
      Entry := Remaining;
      Remaining := '';
    end
    else
    begin
      Entry := Copy(Remaining, 1, Separator - 1);
      Delete(Remaining, 1, Separator);
    end;

    Entry := Trim(Entry);
    if (Entry <> '') and (not SamePathEntry(Entry, Target)) then
    begin
      if Result <> '' then
        Result := Result + ';';
      Result := Result + Entry;
    end;
  end;
end;

function ReadUserPath(): String;
begin
  if not RegQueryStringValue(HKCU, UserEnvironmentKey, 'Path', Result) then
    Result := '';
end;

procedure WriteUserPath(Value: String);
begin
  if Value = '' then
    RegDeleteValue(HKCU, UserEnvironmentKey, 'Path')
  else
    RegWriteExpandStringValue(HKCU, UserEnvironmentKey, 'Path', Value);
end;

procedure AddInstallDirectoryToUserPath();
var
  InstallDirectory: String;
  PreviousDirectory: String;
  UserPath: String;
begin
  InstallDirectory := ExpandConstant('{app}');
  UserPath := ReadUserPath();

  if RegQueryStringValue(HKCU, CommandOwnershipKey,
    CommandOwnershipValue, PreviousDirectory) then
    UserPath := PathWithoutEntry(UserPath, PreviousDirectory);
  UserPath := PathWithoutEntry(UserPath, InstallDirectory);

  if UserPath <> '' then
    UserPath := UserPath + ';';
  UserPath := UserPath + InstallDirectory;
  WriteUserPath(UserPath);
  RegWriteStringValue(HKCU, CommandOwnershipKey,
    CommandOwnershipValue, InstallDirectory);
end;

procedure RemoveManagedInstallDirectoryFromUserPath();
var
  ManagedDirectory: String;
begin
  if RegQueryStringValue(HKCU, CommandOwnershipKey,
    CommandOwnershipValue, ManagedDirectory) then
  begin
    WriteUserPath(PathWithoutEntry(ReadUserPath(), ManagedDirectory));
    RegDeleteValue(HKCU, CommandOwnershipKey, CommandOwnershipValue);
    RegDeleteKeyIfEmpty(HKCU, CommandOwnershipKey);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('addtopath') then
      AddInstallDirectoryToUserPath()
    else
      RemoveManagedInstallDirectoryFromUserPath();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RemoveManagedInstallDirectoryFromUserPath();
end;

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
