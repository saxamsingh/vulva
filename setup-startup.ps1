$Action = New-ScheduledTaskAction -Execute "C:\nvm4w\nodejs\node.exe" -Argument "C:\Users\flypi\Desktop\githubbot\index.js" -WorkingDirectory "C:\Users\flypi\Desktop\githubbot"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName "GitHubHeartbeatBot" -Action $Action -Trigger $Trigger -Settings $Settings -Force
Write-Host "Scheduled task GitHubHeartbeatBot registered successfully!"
Start-ScheduledTask -TaskName "GitHubHeartbeatBot"
Write-Host "Started GitHubHeartbeatBot task!"
