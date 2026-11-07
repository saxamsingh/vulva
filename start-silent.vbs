Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\flypi\Desktop\githubbot"
WshShell.Run "cmd.exe /c node index.js >> bot.log 2>&1", 0, False
