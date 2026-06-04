; ---------------------------------------------------------------------------
; Testnizer NSIS customisation — Windows installer shortcut handling.
;
; The default electron-builder NSIS flow recreates Start Menu and Desktop
; shortcuts every install, but on a v1.4.x → v1.4.3 update the previous
; uninstaller's app paths can collide with the new install location and
; leave the user with a "Missing Shortcut: Testnizer.exe has been changed
; or moved" dialog. This script proactively removes any stale shortcut
; before the installer recreates them so the path always matches the
; freshly-installed exe.
;
; macrocustomInstall fires inside the install section, after files are
; written. We can't rely on electron-builder's own shortcut block running (or
; running after us) — users on v1.4.7/1.4.8 reported a finished install with NO
; Start Menu or Desktop shortcut, so the only launch point was re-running the
; .exe (#33). To make a launch point GUARANTEED regardless of the builder's
; conditional shortcut logic or macro ordering, we delete any stale shortcuts
; and then explicitly CreateShortCut ourselves against the freshly-installed
; exe. If electron-builder also creates them it just overwrites with an
; identical target; if it doesn't, ours remain — either way the app is
; launchable from a shortcut after install.
; ---------------------------------------------------------------------------

!macro customInstall
  ; Strip stale per-user Desktop / Start Menu / Quick Launch shortcuts that
  ; might still point at an older install location.
  SetShellVarContext current
  Delete "$DESKTOP\Testnizer.lnk"
  Delete "$SMPROGRAMS\Testnizer.lnk"
  Delete "$SMPROGRAMS\Testnizer\Testnizer.lnk"
  RMDir  "$SMPROGRAMS\Testnizer"
  Delete "$QUICKLAUNCH\Testnizer.lnk"

  ; Same cleanup for any per-machine remnants from earlier installer
  ; revisions that were configured with perMachine:true.
  SetShellVarContext all
  Delete "$DESKTOP\Testnizer.lnk"
  Delete "$SMPROGRAMS\Testnizer.lnk"
  Delete "$SMPROGRAMS\Testnizer\Testnizer.lnk"
  RMDir  "$SMPROGRAMS\Testnizer"

  ; Restore the current-user context (perMachine:false in package.json) and
  ; create the shortcuts ourselves so a launch point always exists. ${INSTDIR}
  ; holds the just-extracted app; the exe is named after productName.
  SetShellVarContext current
  CreateShortCut "$SMPROGRAMS\Testnizer.lnk" "$INSTDIR\Testnizer.exe" "" "$INSTDIR\Testnizer.exe" 0
  CreateShortCut "$DESKTOP\Testnizer.lnk" "$INSTDIR\Testnizer.exe" "" "$INSTDIR\Testnizer.exe" 0
!macroend

!macro customUnInstall
  ; Mirror the install-time cleanup so leaving the app does not leave a
  ; broken Desktop / Start Menu shortcut behind.
  SetShellVarContext current
  Delete "$DESKTOP\Testnizer.lnk"
  Delete "$SMPROGRAMS\Testnizer.lnk"
  Delete "$SMPROGRAMS\Testnizer\Testnizer.lnk"
  RMDir  "$SMPROGRAMS\Testnizer"
  Delete "$QUICKLAUNCH\Testnizer.lnk"
!macroend
