// Placeholders are filled by official-update.js. Quit the official client, run the downloaded installer, then reopen.
var exe = __EXE_JSON__;
var installer = __INSTALLER_JSON__;
var resources = __RESOURCES_JSON__;
var installDir = __INSTALL_DIR_JSON__;
if (installDir.length > 3) installDir = installDir.replace(/[\\\/]+$/, '');
var logPath = __LOG_JSON__;
var fso = new ActiveXObject('Scripting.FileSystemObject');
var sh = new ActiveXObject('WScript.Shell');
var wmi = GetObject('winmgmts:\\\\.\\root\\cimv2');
function z(n) { return (n < 10 ? '0' : '') + n; }
function stamp() { var d = new Date(); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); }
function log(m) { var f = fso.OpenTextFile(logPath, 8, true); f.WriteLine(stamp() + ' ' + m); f.Close(); }
function samePath(a, b) { return String(a || '').replace(/\//g, '\\').toLowerCase() === String(b || '').replace(/\//g, '\\').toLowerCase(); }
function pids() { var out = []; var name = fso.GetFileName(exe).replace(/'/g, "''"); var e = new Enumerator(wmi.ExecQuery("SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = '" + name + "'")); for (; !e.atEnd(); e.moveNext()) { var p = e.item(); if (samePath(p.ExecutablePath, exe)) out.push(p.ProcessId); } return out; }
function fileSize(fp) { if (!fso.FileExists(fp)) return -1; return fso.GetFile(fp).Size; }
function fileStamp(fp) { if (!fso.FileExists(fp)) return ''; return String(fso.GetFile(fp).DateLastModified); }
// NSIS replaces its entire installation directory. A detached helper started
// from that directory keeps a live CWD handle and can block the final rename.
var installCwd = fso.GetParentFolderName(installer);
try { sh.CurrentDirectory = installCwd; }
catch (cwdErr) {
  log('abort: cannot leave install working directory ' + cwdErr);
  WScript.Quit(1);
}
log('update-begin cwd=' + sh.CurrentDirectory + ' installer=' + installer);
WScript.Sleep(800);
var list = pids();
log('pids ' + list.join(','));
for (var i = 0; i < list.length; i++) sh.Run('taskkill.exe /F /PID ' + list[i], 0, true);
var deadline = new Date().getTime() + 20000;
var left = list;
while (new Date().getTime() < deadline) { left = pids(); if (left.length === 0) break; WScript.Sleep(200); }
log('left ' + left.length);
// Never start the installer while the exact installed executable is still running.
if (left.length) { log('abort: desktop still running'); WScript.Quit(1); }
var asar = resources + '\\app.asar';
var bak = asar + '.bak';
var appDir = resources + '\\app';
var movedApp = false;
var prev = '';
var hadAsar = fso.FileExists(asar);
if (fso.FolderExists(appDir)) {
  prev = appDir + '.dshpurge-prev';
  if (fso.FolderExists(prev)) prev = appDir + '.dshpurge-prev-' + (new Date().getTime());
  for (var n = 0; n < 40; n++) {
    try { fso.MoveFolder(appDir, prev); movedApp = true; log('moved-app'); break; }
    catch (moveErr) { log('move-app ' + (moveErr && moveErr.message ? moveErr.message : moveErr)); WScript.Sleep(250); }
  }
}
// A failed directory move must abort; otherwise NSIS can update one layout while
// Electron starts the old patched resources/app on the next launch.
if (fso.FolderExists(appDir)) {
  log('abort: patched app directory could not be moved');
  sh.Run('"' + exe + '"', 1, false);
  WScript.Quit(1);
}
var copiedAsar = false;
if (!fso.FileExists(asar) && fso.FileExists(bak)) {
  try { fso.CopyFile(bak, asar, true); copiedAsar = true; log('restored-asar'); }
  catch (restoreErr) { log('restore-asar ' + (restoreErr && restoreErr.message ? restoreErr.message : restoreErr)); }
}
if (!fso.FileExists(asar)) {
  log('abort: no official app.asar available for update');
  if (movedApp && fso.FolderExists(prev)) {
    try { fso.MoveFolder(prev, appDir); log('restored-app'); }
    catch (restoreDirErr) { log('restore-app ' + restoreDirErr); }
  }
  sh.Run('"' + exe + '"', 1, false);
  WScript.Quit(1);
}
function psLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function fileVersion(fp) {
  // .NET FileVersion reads the release string; FSO GetFileVersion reads a numeric PE tuple.
  var out = logPath + '.file-version.txt';
  var script = logPath + '.file-version.ps1';
  try {
    if (fso.FileExists(out)) fso.DeleteFile(out, true);
    var writer = fso.CreateTextFile(script, true, true);
    writer.WriteLine("$ErrorActionPreference='Stop'; [IO.File]::WriteAllText(" + psLiteral(out) + ", (Get-Item -LiteralPath " + psLiteral(fp) + ").VersionInfo.FileVersion, [Text.Encoding]::Unicode)");
    writer.Close();
    var code = sh.Run('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + script + '"', 0, true);
    if (code === 0 && fso.FileExists(out)) {
      var reader = fso.OpenTextFile(out, 1, false, -1);
      var value = reader.ReadAll().replace(/^\s+|\s+$/g, ''); reader.Close();
      if (value) return value;
    }
  } catch (versionErr) { log('release-version-probe ' + versionErr); }
  // A numeric fallback will not match an rc/beta release: fail closed, not success by inference.
  try { return String(fso.GetFileVersion(fp) || ''); } catch (fallbackErr) { return ''; }
}
function expectedVersion(fp) {
  var m = fso.GetFileName(fp).match(/([0-9]+\.[0-9]+\.[0-9]+-(?:rc|beta)\.[0-9]+)-win/i);
  return m ? m[1].toLowerCase() : '';
}
var targetVersion = expectedVersion(installer);
var beforeVersion = fileVersion(exe);
var exeBeforeSize = fileSize(exe);
var exeBeforeStamp = fileStamp(exe);
var asarBeforeSize = fileSize(asar);
var asarBeforeStamp = fileStamp(asar);
function runInstaller() {
  // The official electron-updater uses this exact NSIS handoff. /D= is
  // unnecessary for registered upgrades and can override the installed path.
  return sh.Run('"' + installer + '" --updated /S --force-run', 0, true);
}
var code = runInstaller();
log('installer ' + code);
var exeChanged = fileSize(exe) !== exeBeforeSize || fileStamp(exe) !== exeBeforeStamp;
var asarChanged = fileSize(asar) !== asarBeforeSize || fileStamp(asar) !== asarBeforeStamp;
var changed = exeChanged || asarChanged;
var afterVersion = fileVersion(exe);
var versionMatch = !targetVersion || afterVersion.toLowerCase() === targetVersion;
var runtimeFiles = ['versions.json', 'bin\\node.cmd', 'cli\\bin\\dsh.cmd', 'primary-runtime\\dependencies\\node\\bin\\node.exe', 'primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs', 'primary-runtime\\dependencies\\pnpm\\dist\\pnpm.mjs'];
var runtimeMissing = [];
for (var r = 0; r < runtimeFiles.length; r++) if (fileSize(resources + '\\runtime\\' + runtimeFiles[r]) <= 0) runtimeMissing.push(runtimeFiles[r]);
var runtimeReady = runtimeMissing.length === 0;
log('runtime-ready=' + runtimeReady + ' missing=' + runtimeMissing.join(','));
var ok = code === 0 && asarChanged && fso.FileExists(asar) && versionMatch && runtimeReady;
log('changed exe=' + exeChanged + ' asar=' + asarChanged);
log('version before=' + beforeVersion + ' target=' + (targetVersion || 'unavailable') + ' after=' + afterVersion + ' match=' + versionMatch);
// No second installer invocation: silent NSIS may have staged a payload even
// when it failed to swap directories. A retry could corrupt the pending update.
if (!ok) {
  log('abort: installer exit=' + code + ' changed=' + changed);
  // Once the executable version has changed, restoring an older unpacked app
  // would mix versions. Preserve both layouts for recovery and do not relaunch.
  if (beforeVersion && afterVersion && beforeVersion.toLowerCase() !== afterVersion.toLowerCase()) {
    log('manual-recovery-required: executable version changed; preserved current archive and previous app');
    WScript.Quit(1);
  }
  // Do not recursively delete a directory recreated by another process.
  if (movedApp && prev && fso.FolderExists(prev)) {
    if (fso.FolderExists(appDir)) {
      var failedDir = appDir + '.dshpurge-failed-' + (new Date().getTime());
      try { fso.MoveFolder(appDir, failedDir); log('preserved-recreated-app'); }
      catch (clearErr) { log('preserve-recreated-app ' + clearErr); }
    }
    if (!fso.FolderExists(appDir)) {
      try { fso.MoveFolder(prev, appDir); log('restored-app'); }
      catch (backErr) { log('restore-app ' + backErr); }
    }
  }
  // The pre-update layout used resources/app without app.asar. Restore it
  // only after the original patched app is back, so a failed installer never
  // leaves a missing entry point or silently boots an older sealed archive.
  if (!hadAsar && fso.FolderExists(appDir) && fso.FileExists(asar)) {
    try { fso.DeleteFile(asar, true); log('rehid-asar'); } catch (hideErr) { log('rehid-asar ' + hideErr); }
  }
  try { sh.Environment('PROCESS').Remove('ELECTRON_RUN_AS_NODE'); } catch (ignore) {}
  sh.Run('"' + exe + '"', 1, false);
  log('started-old');
} else {
  if (!movedApp && fso.FolderExists(appDir)) log('move-app-failed');
  try {
    var marker = fso.CreateTextFile(resources + '\\dsh-purge-reapply-asar', true);
    marker.WriteLine('1');
    marker.Close();
    log('marker');
  } catch (markerErr) { log('marker ' + markerErr); }
  try { sh.Environment('PROCESS').Remove('ELECTRON_RUN_AS_NODE'); } catch (ignore2) {}
  // --force-run normally restarts the new app. Only launch it ourselves when
  // the installer left the application stopped.
  if (pids().length === 0) { sh.Run('"' + exe + '"', 1, false); log('started'); }
  else log('installer-restarted');
}
