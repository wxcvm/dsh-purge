/** Local persisted routing switches, independent from per-profile rules. */
import fs from "node:fs";
import path from "node:path";

export const ROUTING_KEYS = Object.freeze(["bundledDefault", "redteamTaskRoute", "modelAdaptive", "upstreamSafeBackup"]);

export function routingPath(home) {
  if (!home || typeof home !== "string") throw new Error("DSH_HOME unavailable");
  return path.join(home, "dsh-purge", "prompt-routing.json");
}

export function readRouting(home) {
  const file = routingPath(home);
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("routing settings must be an object");
  const result = {};
  for (const key of ROUTING_KEYS) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== "boolean") throw new TypeError(key + " must be boolean");
      result[key] = value[key];
    }
  }
  return result;
}

export function effectiveRouting(config = {}, persisted = {}) {
  return Object.fromEntries(ROUTING_KEYS.map(key => [key,
    Object.hasOwn(persisted, key) ? persisted[key] : config[key] === true]));
}

export function saveRouting(home, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length
    || Object.entries(patch).some(([k, v]) => !ROUTING_KEYS.includes(k) || typeof v !== "boolean"))
    throw new TypeError("routing patch expects named boolean switches");
  const file = routingPath(home), dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const lock = file + ".lock";
  const fd = fs.openSync(lock, "wx", 0o600);
  const tmp = file + "." + process.pid + ".tmp";
  try {
    const merged = { ...readRouting(home), ...patch };
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
    return merged;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

export function routingPage() {
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Purge · 提示词路由</title><style>',
    ':root{color-scheme:dark;background:#121722;color:#e7edf7;font:15px system-ui,sans-serif}',
    'body{margin:0;padding:30px 16px}main{max-width:700px;margin:auto}h1{font-size:23px}',
    '.help{color:#aebaca;font-size:13px;line-height:1.6}',
    '.item{display:flex;gap:16px;padding:16px;margin:12px 0;background:#1b2433;border:1px solid #344354;border-radius:11px}',
    '.item input{width:20px;height:20px;accent-color:#8d9ffc;flex:none}',
    '.item label{flex:1;cursor:pointer}.item strong{display:block;margin-bottom:5px}.item small{color:#bac5d3;line-height:1.5}',
    'button{border:0;border-radius:8px;padding:10px 15px;background:#586dc8;color:white;cursor:pointer}',
    'button:disabled{opacity:.6}pre{white-space:pre-wrap;background:#1b2433;padding:15px;border-radius:8px;overflow:auto}',
    'a{color:#adbcff}#status{min-height:24px;margin:13px 0;color:#b7d3e7}',
    '</style></head><body><main>',
    '<h1>提示词路由 · 四个独立开关</h1>',
    '<p class="help">调整后立即生效，设置保存在本机并在重启后恢复。Redteam 预设、Session 锁定以及各规则的模型/预设黑白名单仍按原有优先级处理。</p>',
    '<div class="item"><input type="checkbox" id="bundledDefault"><label for="bundledDefault"><strong>无匹配时使用内置提示词</strong><small>普通模式未命中任何规则时才注入；默认关闭。</small></label></div>',
    '<div class="item"><input type="checkbox" id="redteamTaskRoute"><label for="redteamTaskRoute"><strong>普通模式按任务识别红队规则</strong><small>按关键词和已有规则的开关、预设及黑白名单路由；默认关闭。</small></label></div>',
    '<div class="item"><input type="checkbox" id="modelAdaptive"><label for="modelAdaptive"><strong>按当前模型家族启用适配</strong><small>只依据当前请求可识别的模型家族选择适配；默认关闭，未知家族不自动启用。</small></label></div>',
    '<div class="item"><input type="checkbox" id="upstreamSafeBackup"><label for="upstreamSafeBackup"><strong>接手版 2.0 提示词备用方案</strong><small>默认关闭。开启后：红队及已明确启用的内置默认规则切换到接手版加密提示词；所有已命中的正文使用其 persona-prefix 组装方式。普通未命中规则仍不注入，不更改审批或工具权限。关闭即可恢复主方案。</small></label></div>',
    '<button type="button" id="save">保存并立即生效</button> <button type="button" id="reload">重新读取</button>',
    '<div id="status" role="status"></div><h2>最近一次组装诊断</h2>',
    '<p class="help">assembled 仅代表插件段在返回的 prompt sections 中有效；实际模型投递未经宿主边界验证。</p>',
    '<pre id="diagnostic">尚无数据</pre><p class="help"><a href="/dsh-purge/status">插件状态</a></p>',
    '<script>',
    'const keys=["bundledDefault","redteamTaskRoute","modelAdaptive","upstreamSafeBackup"];const status=document.querySelector("#status");',
    'async function api(method,data){const response=await fetch("/dsh-purge/prompt-routing-settings",{method,headers:{"Content-Type":"application/json"},credentials:"same-origin",body:data?JSON.stringify(data):undefined});const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||"HTTP "+response.status);return body;}',
    'async function load(){try{const r=await api("GET");for(const key of keys)document.getElementById(key).checked=r.settings[key]===true;const d=r.lastAssembly||{};document.querySelector("#diagnostic").textContent=JSON.stringify({stage:d.stage||"no-observation",route:d.route||"none",engine:d.promptEngine||"primary",source:d.promptSource||"primary",sourceStatus:d.sourceStatus||"not-observed",assemblyOk:d.ok===true,delivery:d.delivery||"unverified",candidateBytes:d.candidateBytes||0,assembledBytes:d.assembledBytes||0,at:d.at||null},null,2);status.textContent="本机配置已读取";}catch(e){status.textContent="读取失败："+e.message}}',
    'document.querySelector("#save").addEventListener("click",async()=>{const button=document.querySelector("#save");button.disabled=true;try{const settings=Object.fromEntries(keys.map(key=>[key,document.getElementById(key).checked]));await api("POST",{settings});await load();status.textContent="已保存并立即生效";}catch(e){status.textContent="保存失败："+e.message}finally{button.disabled=false}});',
    'document.querySelector("#reload").addEventListener("click",load);load();',
    '</script></main></body></html>',
  ].join("\n");
}
