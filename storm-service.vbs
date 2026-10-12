' STORM MULTIMEDIA - Скрытый фоновый запуск сервера со сторожем (Background Service)
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Запуск watchdog.js без отображения консольного окна (0 = скрытое окно)
WshShell.CurrentDirectory = strPath
WshShell.Run "node watchdog.js", 0, False

Set WshShell = Nothing
Set fso = Nothing
