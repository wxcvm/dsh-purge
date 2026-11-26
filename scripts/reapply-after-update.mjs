// Retired legacy post-update host patching entry point. Official updates
// must not be followed by an automatic unpack, swap, or patch operation.
console.error('旧版更新后回写脚本已停用：不会修改、解包或重启官方宿主。');
console.error('请使用官方安装器恢复已修改的安装，并保留用户数据和已有备份。');
console.error('需要核对版本与安装布局时，请使用只读桌面诊断。');
process.exitCode = 1;
