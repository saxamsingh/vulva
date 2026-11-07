@echo off
echo =========================================
echo   Stopping GitHub Heartbeat Bot...
echo =========================================
powershell -NoProfile -Command ^
  "$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*githubbot*index.js*' }; " ^
  "if ($procs) { " ^
  "  $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host 'Stopped process' $_.ProcessId -ForegroundColor Green }; " ^
  "} else { " ^
  "  Write-Host 'No running bot instances found.' -ForegroundColor Yellow; " ^
  "}"
echo.
pause
