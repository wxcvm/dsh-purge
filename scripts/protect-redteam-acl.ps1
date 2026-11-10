# Protect an operator-selected DSH/Purge redteam workspace with NTFS ACLs.
# Safe by default: omitting -Apply is preview-only. This never runs at startup.
[CmdletBinding()]
param(
    [string]$Root = '',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    throw 'Windows NTFS ACLs are required; use the POSIX permissions feature on other systems.'
}
if (-not $Root) {
    $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
    $Root = Join-Path $dshHome 'redteam'
}
$Root = [System.IO.Path]::GetFullPath($Root)
$driveRoot = [System.IO.Path]::GetPathRoot($Root)
if ($Root.TrimEnd('\') -eq $driveRoot.TrimEnd('\')) {
    throw 'Refusing to modify a drive root; select the Purge redteam workspace.'
}
$rootItem = Get-Item -LiteralPath $Root -Force
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Workspace root must be a real directory, not a junction or symlink.'
}

$identities = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'),
    (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544')
)
$entries = @($rootItem) + @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
$targets = @($entries | Where-Object {
    -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
})
Write-Output ("Purge NTFS ACL: {0} files/directories; mode={1}" -f $targets.Count, $(if ($Apply) { 'apply' } else { 'preview' }))
Write-Output 'New access: current Windows account, SYSTEM, Administrators (FullControl); other access entries removed.'
if (-not $Apply) {
    Write-Output 'Preview only: no changes made. Re-run with -Apply after checking that no other service account needs access.'
    return
}

$updated = 0
foreach ($item in $targets) {
    $acl = Get-Acl -LiteralPath $item.FullName
    $acl.SetAccessRuleProtection($true, $false)
    $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    foreach ($rule in $rules) {
        [void] $acl.RemoveAccessRuleSpecific($rule)
    }
    $inheritance = if ($item.PSIsContainer) {
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($sid in $identities) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $item.FullName -AclObject $acl
    $updated++
}
Write-Output ("Protected {0} existing files/directories. No content, database schema or secrets were changed." -f $updated)
