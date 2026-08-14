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
  #define AppVersion "0.1.0-rc.6-portable.2"
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
OutputBaseFilename=DSH-Portable-windows-x64
SetupIconFile={#ProjectRoot}\assets\DSH-Portable.ico
LicenseFile={#ProjectRoot}\LICENSE
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
VersionInfoVersion=0.1.0.2
VersionInfoProductName=DSH-Portable
VersionInfoDescription=DSH-Portable offline self-extractor
VersionInfoCompany=WSL043

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{app}\DeepSeek-Herness.exe"; Description: "Start DeepSeek-Herness"; Flags: nowait postinstall skipifsilent

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
