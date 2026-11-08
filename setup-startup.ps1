# Registers the bot as a self-healing Windows Scheduled Task (no admin needed).
#  - starts at logon
#  - re-checks every 5 minutes; if the bot is not running it is started again
#    (the bot's own lock file stops duplicates)
#  - runs on battery, catches up if a start was missed
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Action = New-ScheduledTaskAction -Execute "$dir\run-task.bat" -WorkingDirectory $dir

$T1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$T2 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "GitHubHeartbeatBot" -Action $Action -Trigger @($T1, $T2) -Settings $Settings -Force | Out-Null
Write-Host "Task registered." -ForegroundColor Green
Start-ScheduledTask -TaskName "GitHubHeartbeatBot"
Start-Sleep -Seconds 5
Get-ScheduledTask -TaskName "GitHubHeartbeatBot" | Select-Object TaskName, State
