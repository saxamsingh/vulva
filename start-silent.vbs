Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\flypi\Desktop\githubbot"
WshShell.Run "node index.js", 0, False
