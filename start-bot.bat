@echo off
echo =========================================
echo   Starting GitHub Heartbeat Bot...
echo =========================================
powershell -NoProfile -Command ^
  "Start-ScheduledTask -TaskName 'GitHubHeartbeatBot' -ErrorAction SilentlyContinue; " ^
  "Start-Sleep -Seconds 2; " ^
  "$task = Get-ScheduledTask -TaskName 'GitHubHeartbeatBot'; " ^
  "Write-Host 'Task State:' $task.State -ForegroundColor Green;"
echo.
pause
