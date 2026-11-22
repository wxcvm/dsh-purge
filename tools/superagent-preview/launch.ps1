param([Parameter(Mandatory=$true)][string]$DataDir, [int]$Port = 17836, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$Server = Join-Path $PSScriptRoot 'server.mjs'
$Build = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build.json') -Raw | ConvertFrom-Json
$Address = "http://127.0.0.1:$Port"
function Read-Preview {
    try { Invoke-RestMethod "$Address/health" -TimeoutSec 1 } catch { $null }
}
$Health = Read-Preview
if (!$Health) {
    $Node = (Get-Command node -CommandType Application).Source
    $Process = Start-Process -FilePath $Node -ArgumentList ('"{0}" "{1}" {2}' -f $Server,$DataDir,$Port) -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 30 -and !$Health -and !$Process.HasExited; $i++) {
        Start-Sleep -Milliseconds 200
        $Health = Read-Preview
    }
}
if ($Health.preview -ne 'purge-superagent-document-preview' -or $Health.commit -ne $Build.commit) {
    throw '当前端口没有运行本次预览构建。请先关闭占用端口的旧预览；不会自动停止其他程序或回退。'
}
if (!$NoBrowser) { Start-Process $Address }
[pscustomobject]@{ url = $Address; commit = $Health.commit; startedPid = $Process.Id; harness = $false }