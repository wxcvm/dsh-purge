$ErrorActionPreference = 'Stop'
$processes=@(Get-CimInstance Win32_Process)
$roots=@($processes|Where-Object{$_.Name -like '*DeepSeek*Harness*'})
$ids=@($roots|ForEach-Object{[int]$_.ProcessId})
for($i=0;$i -lt 8;$i++){
  $next=@($processes|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId})
  $all=@($ids+$next|Sort-Object -Unique)
  if($all.Count -eq $ids.Count){break}
  $ids=$all
}
$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{($ids -contains [int]$_.OwningProcess) -and $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::')}|ForEach-Object{[int]$_.LocalPort}|Sort-Object -Unique)
$env:QA_PORTS=ConvertTo-Json -InputObject @($ports) -Compress
[ordered]@{stage='desktop-listeners';harnessProcesses=$roots.Count;relatedProcesses=$ids.Count;ports=$ports}|ConvertTo-Json -Compress
node scripts/qa-thinking-live-inspect.mjs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
