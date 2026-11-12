# Windows CI smoke test: dry-run must not change ACL; apply must remove broad readers.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('purge-acl-test-' + [guid]::NewGuid().ToString('N'))
$outside = Join-Path $env:TEMP ('purge-acl-outside-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
New-Item -ItemType Directory -Path $outside -Force | Out-Null
$junction = Join-Path $root 'external-junction'
try {
    $outsideFile = Join-Path $outside 'outside.txt'
    [System.IO.File]::WriteAllText($outsideFile, 'outside fixture')
    $outsideBefore = (Get-Acl -LiteralPath $outsideFile).Sddl
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    $project = Join-Path $root 'engagements'
    New-Item -ItemType Directory -Path $project -Force | Out-Null
    $db = Join-Path $project 'assets.db'
    [System.IO.File]::WriteAllText($db, 'fixture')
    & icacls.exe $db /grant '*S-1-1-0:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare broad-read fixture' }
    $before = (Get-Acl -LiteralPath $db).Sddl
    $script = Join-Path $PSScriptRoot 'protect-redteam-acl.ps1'
    $preview = @(& $script -Root $root)
    $auditLine = @($preview | Where-Object { $_ -like 'ACL_AUDIT *' })
    if ($auditLine.Count -ne 1) { throw 'Expected exactly one audit summary' }
    $audit = $auditLine[0].Substring(10) | ConvertFrom-Json
    if ($audit.inspected -ne 3 -or $audit.broadRead -lt 1 -or $audit.skippedReparse -ne 1 -or $audit.aclReadErrors -ne 0 -or $audit.enumerationErrors -ne 0) {
        throw "Unexpected ACL audit: $($auditLine[0])"
    }
    if (@($preview | Where-Object { $_ -like 'ACL_FINDING *' }).Count -ne 0) { throw 'Default preview disclosed item paths' }
    $details = @(& $script -Root $root -Details)
    $findings = @($details | Where-Object { $_ -like 'ACL_FINDING *' } | ForEach-Object { $_.Substring(12) | ConvertFrom-Json })
    if (@($findings | Where-Object { $_.path -eq 'engagements\assets.db' -and $_.broadRead }).Count -ne 1) { throw 'Expected broad-read database finding' }
    if (@($findings | Where-Object { $_.path -like '*outside*' -or $_.path -like '*external-junction*' }).Count -ne 0) { throw 'Audit traversed junction' }
    if ((Get-Acl -LiteralPath $db).Sddl -ne $before) { throw 'Preview changed file ACL' }
    if ((Get-Acl -LiteralPath $outsideFile).Sddl -ne $outsideBefore) { throw 'Preview changed external file ACL' }
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
    if ((Get-Acl -LiteralPath $outsideFile).Sddl -ne $outsideBefore) { throw 'Apply changed external file ACL' }
    if ([System.IO.File]::ReadAllText($outsideFile) -ne 'outside fixture') { throw 'External file contents changed' }
    $after = @(& $script -Root $root | Where-Object { $_ -like 'ACL_AUDIT *' })[0].Substring(10) | ConvertFrom-Json
    if ($after.broadRead -ne 0 -or $after.otherRead -ne 0 -or $after.inheritanceEnabled -ne 0) { throw 'Protected ACLs still contain unexpected grants or inheritance' }
    Write-Output 'Windows Purge workspace ACL smoke test passed.'
} finally {
    if (Test-Path -LiteralPath $junction) { [System.IO.Directory]::Delete($junction) }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $outside -Recurse -Force -ErrorAction SilentlyContinue
}
