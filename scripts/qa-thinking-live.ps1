$ErrorActionPreference = 'Stop'
if($env:QA_GROUP -notin @('A','B')){throw 'Invalid test arm'}
$runId='DS41-THINKING-20261116-'+$env:QA_GROUP+'-01'
$marker='PURGE-QA-RUN: '+$runId
$modeFile=Join-Path $env:RUNNER_TEMP 'purge-thinking-20261116-mode.txt'
$collector=Join-Path $env:GITHUB_WORKSPACE 'scripts/qa-thinking-live.mjs'
# Prevent an accidental rerun of this exact model request. The marker
# is local to the Runner and contains no credentials or transcript.
$sendMarker=Join-Path $env:RUNNER_TEMP ('purge-qa-'+$runId+'.sent')
if(Test-Path -LiteralPath $sendMarker){
  [ordered]@{stage='thinking-submit';status='already-attempted-no-repeat';taskSubmitted=$false}|ConvertTo-Json -Compress
  & node $collector --collect $env:QA_GROUP
  if($LASTEXITCODE -ne 0){throw 'Previous attempt has no verified result; not resending'}
  return
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$session = (Get-Process -Id $PID).SessionId
$windows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*DeepSeek*Harness*' -and $_.SessionId -eq $session -and $_.MainWindowHandle -ne 0 })
if ($windows.Count -ne 1) { throw 'Expected exactly one accessible Harness window' }
$handle = $windows[0].MainWindowHandle
function Get-Controls {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}
function Get-Pattern($element,$pattern) {
  $obj = $null
  if ($element.TryGetCurrentPattern($pattern,[ref]$obj)) { return $obj }
  return $null
}
function Is-Visible($c) {
  try { return ($c.Current.IsEnabled -and -not $c.Current.IsOffscreen -and $c.Current.BoundingRectangle.Width -gt 0 -and $c.Current.BoundingRectangle.Height -gt 0) } catch { return $false }
}
function Get-Composer {
  @(Get-Controls | Where-Object {
    try { (Is-Visible $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.ClassName -eq 'GRgSLq_input' } catch { $false }
  })
}
# Chromium's accessibility ExpandCollapse may report success without
# making the DOM menu visible. Inspect the actual labelled control;
# click only its verified hit point if Expand did not expose options.
Add-Type -AssemblyName WindowsBase
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QaDesktopMouse {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; public Point(int x,int y){X=x;Y=y;} }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
function Same-Element($a,$b) {
  if($null -eq $a -or $null -eq $b){return $false}
  try { return (($a.GetRuntimeId() -join ',') -eq ($b.GetRuntimeId() -join ',')) } catch { return $false }
}
function Is-DescendantOrSelf($node,$target) {
  $walker=[System.Windows.Automation.TreeWalker]::RawViewWalker
  for($j=0;$j -lt 24 -and $null -ne $node;$j++){
    if(Same-Element $node $target){return $true}
    try{$node=$walker.GetParent($node)}catch{break}
  }
  return $false
}
function App-Foreground {
  $fg=[QaDesktopMouse]::GetForegroundWindow()
  return ($fg -ne [IntPtr]::Zero -and [QaDesktopMouse]::GetAncestor($fg,2) -eq [QaDesktopMouse]::GetAncestor($handle,2))
}
function Activate-Harness {
  if(App-Foreground){return $true}
  if([QaDesktopMouse]::IsIconic($handle)){[void][QaDesktopMouse]::ShowWindowAsync($handle,9);Start-Sleep -Milliseconds 300}
  $activated=$false
  try{
    $shell=New-Object -ComObject WScript.Shell
    $activated=[bool]$shell.AppActivate([int]$windows[0].Id)
    Start-Sleep -Milliseconds 400
  }catch{}
  if(-not (App-Foreground)){[void][QaDesktopMouse]::SetForegroundWindow($handle);Start-Sleep -Milliseconds 350}
  [ordered]@{stage='desktop-activation';appActivate=$activated;foreground=(App-Foreground);foregroundWindowPresent=([QaDesktopMouse]::GetForegroundWindow() -ne [IntPtr]::Zero)}|ConvertTo-Json -Compress|Write-Host
  return (App-Foreground)
}
function Focus-Verified($element) {
  if(-not (Is-Visible $element)){return $false}
  if([QaDesktopMouse]::IsIconic($handle)){[void][QaDesktopMouse]::ShowWindowAsync($handle,9);Start-Sleep -Milliseconds 300}
  try{$element.SetFocus()}catch{}
  if(-not (App-Foreground)){[void][QaDesktopMouse]::SetForegroundWindow($handle);Start-Sleep -Milliseconds 350}
  try{$element.SetFocus()}catch{}
  Start-Sleep -Milliseconds 180
  $focused=$false
  try{$focused=(Is-DescendantOrSelf ([System.Windows.Automation.AutomationElement]::FocusedElement) $element) -or $element.Current.HasKeyboardFocus}catch{}
  [ordered]@{stage='focus-verification';foreground=(App-Foreground);targetFocused=$focused;class=$element.Current.ClassName}|ConvertTo-Json -Compress|Write-Host
  return ((App-Foreground) -and $focused)
}
function Open-Verified($element) {
  if(-not (Focus-Verified $element)){return $false}
  # Only deliver Enter when the exact intended control owns focus and
  # the foreground root is the authorized Harness window.
  [QaDesktopMouse]::keybd_event(13,0,0,[UIntPtr]::Zero)
  [QaDesktopMouse]::keybd_event(13,0,2,[UIntPtr]::Zero)
  return $true
}
function Click-Verified($element) {
  if (-not (Is-Visible $element)) { return $false }
  if(-not (App-Foreground)){[void](Activate-Harness)}
  $b=$element.Current.BoundingRectangle
  $x=[int]($b.Left+$b.Width/2);$y=[int]($b.Top+$b.Height/2)
  $nativeHit=[QaDesktopMouse]::WindowFromPoint([QaDesktopMouse+Point]::new($x,$y))
  $windowMatched=($nativeHit -ne [IntPtr]::Zero -and [QaDesktopMouse]::GetAncestor($nativeHit,2) -eq [QaDesktopMouse]::GetAncestor($handle,2))
  $hitMatched=$false
  try{$hit=[System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($x,$y));$hitMatched=Is-DescendantOrSelf $hit $element}catch{}
  [ordered]@{stage='click-verification';foreground=(App-Foreground);windowMatched=$windowMatched;targetMatched=$hitMatched;class=$element.Current.ClassName}|ConvertTo-Json -Compress|Write-Host
  if(-not (App-Foreground) -or -not $windowMatched -or -not $hitMatched){return $false}
  [void][QaDesktopMouse]::SetCursorPos($x,$y)
  [QaDesktopMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [QaDesktopMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  return $true
}
function Get-PresetSeat {
  @(Get-Controls|Where-Object{try{(Is-Visible $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.ClassName -eq 'm2hUqa_seat'}catch{$false}})
}
# Bring Harness to the foreground before creating a conversation.
# UIA Invoke can otherwise return while the old conversation is still visible.
$foregroundReady=Activate-Harness
if(-not $foregroundReady){
  [ordered]@{stage='thinking-submit';status='desktop-not-foreground';taskSubmitted=$false}|ConvertTo-Json -Compress
  throw 'Desktop unavailable'
}
$new=@(Get-Controls|Where-Object{try{(Is-Visible $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('新建会话','新建对话','New Chat','New Conversation','New Session') -and $null -ne (Get-Pattern $_ ([System.Windows.Automation.InvokePattern]::Pattern))}catch{$false}})
if($new.Count -eq 0){throw 'New Chat unavailable'}
$opened=Click-Verified $new[0]
if(-not $opened){(Get-Pattern $new[0] ([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}
$pickers=@()
$editor=@()
for($i=0;$i -lt 24;$i++){
  Start-Sleep -Milliseconds 250
  $pickers=@(Get-PresetSeat)
  $editor=@(Get-Composer)
  if($pickers.Count -eq 1 -and $editor.Count -eq 1){break}
}
[ordered]@{stage='fresh-conversation';nativeClick=$opened;foreground=(App-Foreground);presetSeats=$pickers.Count;composers=$editor.Count}|ConvertTo-Json -Compress
if($pickers.Count -ne 1 -or $editor.Count -ne 1){
  [ordered]@{stage='thinking-submit';status='fresh-conversation-not-confirmed';taskSubmitted=$false}|ConvertTo-Json -Compress
  throw 'Fresh conversation not confirmed'
}
$vp=Get-Pattern $editor[0] ([System.Windows.Automation.ValuePattern]::Pattern)
if($null -eq $vp -or $vp.Current.IsReadOnly -or -not [string]::IsNullOrWhiteSpace($vp.Current.Value)){
  [ordered]@{stage='thinking-submit';status='fresh-composer-not-empty-or-writable';taskSubmitted=$false}|ConvertTo-Json -Compress
  throw 'Composer not ready'
}
$rect=$editor[0].Current.BoundingRectangle
# Read the fresh conversation's settings. Never open or change a
# preset, model, collaboration toggle or permission control.
$mode=[string]$pickers[0].Current.Name
$standard=($mode -match '^(标准模式|Standard(?: mode)?|红队模式|Red[ -]?team(?: mode)?)$')
if($env:QA_GROUP -eq 'B' -and (!(Test-Path -LiteralPath $modeFile) -or (Get-Content -LiteralPath $modeFile -Raw).Trim() -cne $mode)){throw 'A/B mode changed; no submission'}
$models=@(Get-Controls|Where-Object{try{(Is-Visible $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.ClassName -eq '_9r0rkG_trigger'}catch{$false}})
$modelOk=$false
if($models.Count -eq 1){$modelOk=([string]$models[0].Current.Name -match '(?i)DeepSeek[-\s]*V4\.1[-\s]*Flash' -and [string]$models[0].Current.Name -match '(?i)\bMax\b')}
[ordered]@{stage='thinking-settings';presetVerified=$standard;modelMaxVerified=$modelOk;settingsChanged=$false}|ConvertTo-Json -Compress
if(-not ($standard -and $modelOk)){throw 'Known preset or DeepSeek V4.1 Flash Max not confirmed; no submission'}
if($env:QA_GROUP -eq 'A'){$mode | Set-Content -LiteralPath $modeFile -Encoding utf8}
$packet = ((& node $collector --packet $env:QA_GROUP) -join [char]10).TrimEnd()
if ($LASTEXITCODE -ne 0 -or -not $packet.StartsWith($marker) -or $packet.Length -lt 100) { throw 'Could not generate the exact QA packet' }
function Normalize-ComposerText($text) {
  if($null -eq $text){return ''}
  return (([string]$text).Replace(([string][char]13+[string][char]10),[string][char]10).Replace([string][char]13,[string][char]10)).TrimEnd()
}
function Read-Composer($element,$expected) {
  $value=''
  $text=''
  try{$p=Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern);if($null -ne $p){$value=Normalize-ComposerText $p.Current.Value}}catch{}
  try{$p=Get-Pattern $element ([System.Windows.Automation.TextPattern]::Pattern);if($null -ne $p){$text=Normalize-ComposerText ($p.DocumentRange.GetText(-1))}}catch{}
  return [ordered]@{
    valueLength=$value.Length;textLength=$text.Length
    valueMatches=($value -ceq $expected);textMatches=($text -ceq $expected)
    valueMarker=$value.StartsWith($marker)
    textMarker=$text.StartsWith($marker)
  }
}
$packet=Normalize-ComposerText $packet
$verified=$false
$readback=$null
# Use the real Chromium paste event. Preserve the user's clipboard as
# an opaque data object; do not inspect or log its contents.
Add-Type -AssemblyName System.Windows.Forms
$editor=@(Get-Composer)
if($editor.Count -ne 1){throw 'Expected one fresh composer'}
if(-not (Click-Verified $editor[0])){[void](Activate-Harness)}
if(-not (Focus-Verified $editor[0])){throw 'Cannot confirm Harness composer focus; no paste performed'}
if([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA){throw 'Clipboard requires STA; no paste performed'}
$oldClipboard=[System.Windows.Forms.Clipboard]::GetDataObject()
try{
  [System.Windows.Forms.Clipboard]::SetText($packet,[System.Windows.Forms.TextDataFormat]::UnicodeText)
  if(-not (Focus-Verified $editor[0])){throw 'Composer lost focus; no paste performed'}
  [QaDesktopMouse]::keybd_event(17,0,0,[UIntPtr]::Zero)
  try{
    [QaDesktopMouse]::keybd_event(86,0,0,[UIntPtr]::Zero)
    [QaDesktopMouse]::keybd_event(86,0,2,[UIntPtr]::Zero)
  }finally{[QaDesktopMouse]::keybd_event(17,0,2,[UIntPtr]::Zero)}
  for($i=0;$i -lt 12;$i++){
    Start-Sleep -Milliseconds 300
    $editor=@(Get-Composer)
    if($editor.Count -ne 1){break}
    $readback=Read-Composer $editor[0] $packet
    if($readback.valueMatches -or $readback.textMatches){$verified=$true;break}
  }
}finally{
  try{
    if($null -ne $oldClipboard){[System.Windows.Forms.Clipboard]::SetDataObject($oldClipboard,$true,5,100)}
    else{[System.Windows.Forms.Clipboard]::Clear()}
  }catch{Write-Warning 'Clipboard restoration failed; clipboard may contain the fictional QA packet.'}
}
[ordered]@{stage='composer-entry';method='verified-paste';packetLength=$packet.Length;verified=$verified;readback=$readback}|ConvertTo-Json -Depth 5 -Compress
if(-not $verified){
  [ordered]@{stage='thinking-submit';status='composer-readback-mismatch';taskSubmitted=$false;readback=$readback}|ConvertTo-Json -Depth 5 -Compress
  throw 'Composer content not verified'
}
$send = @(Get-Controls | Where-Object {
  try {
    (Is-Visible $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -match '^(发送(?:消息)?|Send(?: message)?)(?:\s*\([^)]*\))?$' -and $null -ne (Get-Pattern $_ ([System.Windows.Automation.InvokePattern]::Pattern))
  } catch { $false }
})
if ($send.Count -ne 1) {
  $bounds=$editor[0].Current.BoundingRectangle
  $localButtons=@(Get-Controls|Where-Object{try{(Is-Visible $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.BoundingRectangle.Left -ge ($bounds.Left-40) -and $_.Current.BoundingRectangle.Right -le ($bounds.Right+40) -and $_.Current.BoundingRectangle.Top -ge ($bounds.Top-100) -and $_.Current.BoundingRectangle.Bottom -le ($bounds.Bottom+240)}catch{$false}}|ForEach-Object{[ordered]@{class=$_.Current.ClassName;enabled=$_.Current.IsEnabled;label=if($_.Current.Name -match '^(发送|Send|停止|Stop|提交|Submit|运行|Run)'){[string]$_.Current.Name}else{$null};patterns=@($_.GetSupportedPatterns()|ForEach-Object{$_.ProgrammaticName})}})
  [ordered]@{stage='thinking-submit';status='draft-entered-send-control-not-unique';sendCandidates=$send.Count;localButtons=$localButtons;taskSubmitted=$false} | ConvertTo-Json -Depth 6 -Compress
  throw 'Send control not verified'
}
# Reserve the unique run marker before sending. A retry after an
# ambiguous click must inspect the archive rather than resend.
$currentSeat=@(Get-PresetSeat)
if($currentSeat.Count -ne 1 -or [string]$currentSeat[0].Current.Name -cne $mode){throw 'Preset changed; no submission'}
$reservation=[System.IO.File]::Open($sendMarker,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write)
$reservation.Dispose()
$clicked=Click-Verified $send[0]
if(-not $clicked){(Get-Pattern $send[0] ([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}
Start-Sleep -Milliseconds 1200
[ordered]@{stage='thinking-submit';status='send-invoked';runId=$runId;taskSubmitted=$true;modelCompletionVerified=$false} | ConvertTo-Json -Compress
& node $collector --collect $env:QA_GROUP
if($LASTEXITCODE -ne 0){throw 'No completed verified result; no automatic resend'}
