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
; written but before electron-builder's shortcut creation, so deleting
; first / creating after produces a single fresh shortcut without the
; orphan-pointing-at-old-version problem.
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

  ; Restore the current-user context for electron-builder's own shortcut
  ; creation logic (perMachine:false in package.json).
  SetShellVarContext current
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
