$Action = New-ScheduledTaskAction -Execute "C:\Users\flypi\Desktop\githubbot\run-task.bat" -WorkingDirectory "C:\Users\flypi\Desktop\githubbot"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName "GitHubHeartbeatBot" -Action $Action -Trigger $Trigger -Settings $Settings -Force
Write-Host "Scheduled task GitHubHeartbeatBot registered successfully!"
Stop-ScheduledTask -TaskName "GitHubHeartbeatBot" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName "GitHubHeartbeatBot"
Start-Sleep -Seconds 4
Get-ScheduledTask -TaskName "GitHubHeartbeatBot"
