@echo off
echo =========================================
echo   GitHub Heartbeat Bot Status
echo =========================================
powershell -NoProfile -Command ^
  "$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*githubbot*index.js*' }; " ^
  "if ($procs) { " ^
  "  Write-Host 'STATUS: [ACTIVE] Bot is running silently in the background.' -ForegroundColor Green; " ^
  "  foreach ($p in $procs) { Write-Host 'PID:' $p.ProcessId 'Started:' $p.CreationDate }; " ^
  "} else { " ^
  "  Write-Host 'STATUS: [INACTIVE] Bot is not running.' -ForegroundColor Yellow; " ^
  "}"
echo.
pause
