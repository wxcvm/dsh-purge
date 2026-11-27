<#
.SYNOPSIS
  Retired legacy archive swap helper. Does not touch the installation.
.DESCRIPTION
  Keep the historical parameters for compatibility with older callers.
  Use the official installer to recover modified installations instead.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot,
  [int]$BootWaitSeconds = 60,
  [switch]$DryRun
)
Write-Warning 'Legacy desktop archive swap is retired. No files or processes were changed.'
Write-Warning 'Keep existing backups and user data. Recover modified installations using the official installer.'
exit 1
