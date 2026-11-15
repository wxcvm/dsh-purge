# Protect an operator-selected DSH/Purge redteam workspace with NTFS ACLs.
# Safe by default: omitting -Apply is preview-only. This never runs at startup.
[CmdletBinding()]
param(
    [string]$Root = '',
    [switch]$Apply,
    [switch]$Details
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

# Use the canonical directory path for relative diagnostic names.
$Root = $rootItem.FullName.TrimEnd([char[]]'\/')

$identities = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'),
    (New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544')
)
# Enumerate explicitly so directory reparse points are never traversed.
# Enumeration failures are reported rather than being mistaken for clean trees.
$targets = [System.Collections.Generic.List[object]]::new()
$pending = [System.Collections.Generic.Stack[object]]::new()
$pending.Push($rootItem)
$skippedReparse = 0
$enumerationErrors = 0
while ($pending.Count -gt 0) {
    $item = $pending.Pop()
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $skippedReparse++
        continue
    }
    $targets.Add($item)
    if ($item.PSIsContainer) {
        try {
            foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)) {
                $pending.Push($child)
            }
        } catch {
            $enumerationErrors++
        }
    }
}
Write-Output ("Purge NTFS ACL: {0} files/directories; mode={1}" -f $targets.Count, $(if ($Apply) { 'apply' } else { 'preview' }))
Write-Output 'New access: current Windows account, SYSTEM, Administrators (FullControl); other access entries removed.'
if (-not $Apply) {
    # Count grants, not effective access: deny rules, group membership, parent
    # traversal permissions and network-share ACLs can change actual access.
    $allowed = @($identities | ForEach-Object { $_.Value })
    $broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    $summary = [ordered]@{
        inspected = 0
        broadRead = 0
        otherRead = 0
        inheritanceEnabled = 0
        aclReadErrors = 0
        skippedReparse = $skippedReparse
        enumerationErrors = $enumerationErrors
    }
    foreach ($item in $targets) {
        try {
            # Windows PowerShell 5.1 uses .NET Framework's native ACL API.
            # Avoid provider/module differences when launched from a PowerShell 7 runner.
            if ($PSVersionTable.PSEdition -eq 'Desktop') {
                $sections = [System.Security.AccessControl.AccessControlSections]::Access
                $acl = if ($item.PSIsContainer) {
                    [System.IO.Directory]::GetAccessControl($item.FullName, $sections)
                } else {
                    [System.IO.File]::GetAccessControl($item.FullName, $sections)
                }
            } else {
                $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
            }
            $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
            $hasBroad = $false
            $hasOther = $false
            foreach ($rule in $rules) {
                if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
                # Inherit-only ACEs do not grant read access to this item itself.
                if ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
                if (-not ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::ReadData)) { continue }
                $sid = $rule.IdentityReference.Value
                if ($sid -in $broad) { $hasBroad = $true }
                if ($sid -notin $allowed -and $sid -notin $broad) { $hasOther = $true }
            }
            $summary.inspected++
            if ($hasBroad) { $summary.broadRead++ }
            if ($hasOther) { $summary.otherRead++ }
            if (-not $acl.AreAccessRulesProtected) { $summary.inheritanceEnabled++ }
            if ($Details -and ($hasBroad -or $hasOther -or -not $acl.AreAccessRulesProtected)) {
                $relative = if ($item.FullName -eq $Root) { '.' } else { $item.FullName.Substring($Root.Length).TrimStart([char[]]'\/') }
                Write-Output ('ACL_FINDING ' + ([ordered]@{
                    path = $relative
                    broadRead = $hasBroad
                    otherRead = $hasOther
                    inheritanceEnabled = -not $acl.AreAccessRulesProtected
                } | ConvertTo-Json -Compress))
            }
        } catch {
            $summary.aclReadErrors++
            if ($Details) {
                $relative = if ($item.FullName -eq $Root) { '.' } else { $item.FullName.Substring($Root.Length).TrimStart([char[]]'\/') }
                Write-Output ('ACL_FINDING ' + ([ordered]@{ path = $relative; status = 'acl_unreadable'; errorType = $_.Exception.GetType().Name } | ConvertTo-Json -Compress))
            }
        }
    }
    Write-Output ('ACL_AUDIT ' + ($summary | ConvertTo-Json -Compress))
    Write-Output 'Counts describe observed allow entries, not proven effective access; review broad/other grants and incomplete checks.'
    Write-Output 'Preview only: no changes made. Re-run with -Apply after checking that no other service account needs access.'
    return
}
if ($enumerationErrors -gt 0) {
    throw 'Workspace enumeration was incomplete; no ACL changes made. Review permissions and retry.'
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
