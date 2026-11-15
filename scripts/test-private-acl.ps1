# Windows CI smoke test: dry-run must not change ACL; apply must remove broad readers.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('purge-acl-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
    $project = Join-Path $root 'engagements'
    New-Item -ItemType Directory -Path $project -Force | Out-Null
    $db = Join-Path $project 'assets.db'
    [System.IO.File]::WriteAllText($db, 'fixture')
    & icacls.exe $db /grant '*S-1-1-0:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare broad-read fixture' }
    $before = (Get-Acl -LiteralPath $db).Sddl
    & (Join-Path $PSScriptRoot 'protect-redteam-acl.ps1') -Root $root | Out-Null
    if ((Get-Acl -LiteralPath $db).Sddl -ne $before) { throw 'Preview changed file ACL' }
    & (Join-Path $PSScriptRoot 'protect-redteam-acl.ps1') -Root $root -Apply | Out-Null
    $allowed = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
        'S-1-5-18', 'S-1-5-32-544'
    )
    foreach ($path in @($root, $project, $db)) {
        $acl = Get-Acl -LiteralPath $path
        if (-not $acl.AreAccessRulesProtected) { throw "Inheritance remains enabled on $path" }
        foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
                throw "Unexpected deny ACL on $path"
            }
            if ($rule.IdentityReference.Value -notin $allowed) {
                throw "Unexpected user/group ACL on $path"
            }
        }
    }
    if ([System.IO.File]::ReadAllText($db) -ne 'fixture') { throw 'Protected file contents changed' }
    Write-Output 'Windows Purge workspace ACL smoke test passed.'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
