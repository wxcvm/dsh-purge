import { parse } from 'yaml'

/** Compare user-selected snapshots, never query a service or return values. */
export function compareServiceConfig(expected, observed, format = 'yaml') {
  if (typeof expected !== 'string' || typeof observed !== 'string' || !expected.trim() || !observed.trim()) throw new Error('请选择两份非空配置')
  if (format === 'text') {
    const a = expected.replace(/\r\n/g,'\n').split('\n'), b = observed.replace(/\r\n/g,'\n').split('\n')
    let changed = 0
    for (let i=0;i<Math.min(a.length,b.length);i++) if (a[i] !== b[i]) changed++
    return { ok:true, mode:'text', equal:changed===0 && a.length===b.length, counts:{ changed,added:Math.max(0,b.length-a.length),removed:Math.max(0,a.length-b.length) }, runtime:'not_tested', note:'文本逐行位置对比；换行以外的格式和注释差异也会计入，不能推断语义等价或运行状态。' }
  }
  if (!['json','yaml'].includes(format)) throw new Error('未知配置格式')
  let a,b
  try {
    const load = format === 'json' ? JSON.parse : value => parse(value,{maxAliasCount:20})
    a=load(expected); b=load(observed)
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') throw Error('invalid root')
  } catch { throw new Error('配置解析失败；请检查所选格式（不回显文件内容）') }
  const counts={added:0,removed:0,changed:0}
  const paths=[]
  const seen = new WeakMap()
  const record=(kind,path)=>{counts[kind]++; if(paths.length<100) paths.push({kind,path})}
  const walk=(x,y,path)=>{
    if (Object.is(x,y)) return
    const object = v => v !== null && typeof v === 'object'
    if (!object(x) || !object(y) || Array.isArray(x)!==Array.isArray(y)) { record('changed',path); return }
    // YAML aliases may share objects. A repeated pair on the active traversal is a cycle.
    let pair=seen.get(x)
    if (!pair) {pair=new WeakSet();seen.set(x,pair)}
    if(pair.has(y)) throw Error('配置包含循环引用，无法比较')
    pair.add(y)
    try {
      const keys = new Set([...Object.keys(x),...Object.keys(y)])
      for (const key of keys) {
        const next=path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1')
        if(!Object.hasOwn(x,key)) record('added',next)
        else if(!Object.hasOwn(y,key)) record('removed',next)
        else walk(x[key],y[key],next)
      }
    } finally {pair.delete(y)}
  }
  walk(a,b,'')
  return {ok:true, mode:format, equal:Object.values(counts).every(n=>n===0),counts,paths,omitted:Math.max(0,Object.values(counts).reduce((s,n)=>s+n,0)-paths.length),runtime:'not_tested',note:'比较解析后的配置字段，不返回值；数组按位置比较。文件一致不证明服务已加载该配置。字段名可能敏感，请勿分享未经核对的报告。'}
}
