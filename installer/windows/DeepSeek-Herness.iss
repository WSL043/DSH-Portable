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
  #define AppVersion "0.2.0-rc.1"
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
CloseApplications=no
RestartApplications=no
VersionInfoVersion=0.2.0.1
VersionInfoProductName=DeepSeek-Herness
VersionInfoDescription=DeepSeek-Herness installer
VersionInfoCompany=WSL043

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Excludes: "\data\*,\workspace\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\DeepSeek-Herness"; Filename: "{app}\DeepSeek-Herness.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeepSeek-Herness.exe"
Name: "{group}\Stop DeepSeek-Herness"; Filename: "{app}\Stop DeepSeek-Herness.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Stop DeepSeek-Herness.exe"
Name: "{autodesktop}\DeepSeek-Herness"; Filename: "{app}\DeepSeek-Herness.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeepSeek-Herness.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Run]
Filename: "{app}\DeepSeek-Herness.exe"; Description: "Start DeepSeek-Herness"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Stop DeepSeek-Herness.exe"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopDeepSeekHerness"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopEntry: String;
begin
  Result := '';
  StopEntry := ExpandConstant('{app}\Stop DeepSeek-Herness.exe');
  if FileExists(StopEntry) then
  begin
    if not Exec(StopEntry, '', ExpandConstant('{app}'), SW_HIDE,
      ewWaitUntilTerminated, ResultCode) then
      Result := 'The existing DeepSeek-Herness process could not be stopped.'
    else if ResultCode <> 0 then
      Result := 'DeepSeek-Herness is still running. Stop it before updating.';
  end;
end;
