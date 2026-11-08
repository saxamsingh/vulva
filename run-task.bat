@echo off
cd /d "C:\Users\flypi\Desktop\githubbot"
rem Keep bot.log from growing forever (keep last ~2000 lines when over ~2MB)
for %%F in (bot.log) do if %%~zF GTR 2000000 (powershell -NoProfile -Command "Get-Content bot.log -Tail 2000 | Set-Content bot.log.tmp; Move-Item -Force bot.log.tmp bot.log")
"C:\nvm4w\nodejs\node.exe" index.js >> bot.log 2>&1
