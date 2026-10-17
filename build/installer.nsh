; Frontier App's additions to electron-builder's NSIS scripts (18.2, D-050). electron-builder includes this file by itself.
;
; The uninstaller removes the program only. electron-builder's uninstaller also takes a switch, --delete-app-data, that
; would remove %APPDATA%\frontier-app: every chat, key, limit and setting. Windows never passes it (Settings > Apps and
; the Start menu run the uninstaller without it), but any program could. So the uninstaller refuses to run at all when
; it is given, and removes nothing. A person who wants the data gone deletes the folder themselves.
!macro customUnInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Frontier App's uninstaller does not delete your chats and settings. Nothing was removed." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

; The installer takes the same switch and hands it to the old uninstaller during an update. It refuses it too.
!macro customInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Frontier App's installer does not delete your chats and settings. Nothing was installed." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
