// Retired: the legacy preparer changed official installation files using an
// unverified backup and a hard-coded installation directory. Leave the host
// entirely untouched; preserve the entry point for callers of older scripts.
console.error('此旧版官方更新准备脚本已停用：不会修改、移动或删除任何安装文件。');
console.error('请先退出 Harness，保留用户数据和现有备份，并使用官方安装器恢复已修改的安装。');
console.error('官方更新与恢复完成前，不要重新应用宿主补丁。');
console.error('旧版脚本不再提供自动恢复；退出码 1 表示未执行准备操作。');
process.exitCode = 1;
