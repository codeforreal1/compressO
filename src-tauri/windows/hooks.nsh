; Installer hooks (`bundle.windows.nsis.installerHooks` in tauri.conf.json)
;
; The `compresso` command (see `src/sys/cli_install.rs`): a copy of the command line tool in the
; `bin` folder of the install folder, which is added to the user's PATH. The folder is passed to
; PowerShell in an environment variable, so no path needs quoting.

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\bin"
  CopyFiles /SILENT "$INSTDIR\compresso-cli.exe" "$INSTDIR\bin\compresso.exe"
  System::Call 'Kernel32::SetEnvironmentVariable(t "COMPRESSO_BIN", t "$INSTDIR\bin")i'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = $$env:COMPRESSO_BIN; $$path = [Environment]::GetEnvironmentVariable('Path', 'User'); $$entries = @(([string]$$path) -split ';' | Where-Object { $$_ -ne '' }); if (-not ($$entries | Where-Object { $$_.TrimEnd('\') -ieq $$bin })) { [Environment]::SetEnvironmentVariable('Path', (($$entries + $$bin) -join ';'), 'User') }"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  System::Call 'Kernel32::SetEnvironmentVariable(t "COMPRESSO_BIN", t "$INSTDIR\bin")i'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = $$env:COMPRESSO_BIN; $$path = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($$path) { $$kept = @($$path -split ';' | Where-Object { $$_ -ne '' -and $$_.TrimEnd('\') -ine $$bin }); [Environment]::SetEnvironmentVariable('Path', ($$kept -join ';'), 'User') }"`
  Pop $0
  Delete "$INSTDIR\bin\compresso.exe"
  RMDir "$INSTDIR\bin"
!macroend
