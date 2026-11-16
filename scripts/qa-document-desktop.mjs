/** Temporary local runner for the new, fictional office-record fixture. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { documentReviewPacket, scoreDocumentReviewText } from './document-review-eval.mjs'
import { decodeArchive, extractMarkedTurn } from './review-trace-import.mjs'

const marker='PURGE-QA-RUN: DS41-DESKTOP-20261116-OFFICE-REVIEW-01'
if(process.argv[2]==='--packet'){
  // D's observed answer letters and evidence sets, reconstructed from the
  // completed scorer's exact/missing/additional keys. Order is normalized;
  // no corrections, expected evidence labels or scores are sent to the model.
  const candidateReports=[
    {id:'invoice-posted',answer:'b',evidence:['ledger','reminder']},
    {id:'meeting-effective',answer:'a',evidence:['original','amendment','draft']},
    {id:'partial-returns',answer:'c',evidence:['scope','report','inspections']},
    {id:'refund-allocation',answer:'a',evidence:['refund','mapping','totals']},
    {id:'delivery-cutoff',answer:'b',evidence:['purchase','receipt1','receipt2','receipt3','cutoff']},
    {id:'approval-chain',answer:'c',evidence:['rule','current','program','finance','register']},
  ]
  console.log(marker+'\nThe supplied fictional office records and candidate reports are from a previous review, not an answer key. Independently review each candidate against all its original records. Decide the answer yourself, check whether every record required to justify the conclusion is present, remove redundant citations and correct any omission or mistake. Do not merely accept the candidate; do not delegate, call tools, read files or access external resources. Return exactly one bare JSON object with a reports array and no Markdown fences or extra text.\n'+JSON.stringify({...documentReviewPacket(),candidateReports},null,2))
}else if(process.argv[2]==='--collect'){
  const root=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'sessions')
  const cutoff=Date.now()-120000
  const deadline=Date.now()+45000
  const list=folder=>{try{return fs.readdirSync(folder,{withFileTypes:true})}catch{return []}}
  function find(){
    const results=[]
    const visit=(folder,depth)=>{
      for(const d of list(folder)){
        if(!d.isDirectory()||d.isSymbolicLink())continue
        const child=path.join(folder,d.name)
        for(const name of ['session.v4.jsonl.zstd','session.v4.jsonl']){
          const file=path.join(child,name)
          try{
            const st=fs.lstatSync(file)
            if(!st.isFile()||st.isSymbolicLink()||st.mtimeMs<cutoff)continue
            const records=decodeArchive(fs.readFileSync(file))
            const trace=extractMarkedTurn(records,marker)
            results.push(trace)
            break
          }catch{}
        }
        if(depth<1)visit(child,depth+1)
      }
    }
    visit(root,0)
    return results
  }
  const sum=(attempts,key)=>attempts.length&&attempts.every(a=>Number.isFinite(a[key])&&a[key]>=0)?attempts.reduce((n,a)=>n+a[key],0):null
  let status='not-found'
  do{
    const matches=find()
    if(matches.length>1){console.log(JSON.stringify({stage:'office-result',status:'ambiguous-marked-turn'}));break}
    if(matches.length===1){
      const trace=matches[0]
      status=trace.lifecycle
      if(['completed','failed','aborted'].includes(status)){
        console.log(JSON.stringify({stage:'office-result',status,route:trace.route,elapsedMs:trace.elapsedMs,
          observedChildren:trace.childIds.length,modelResponses:trace.attempts.length,toolStarts:sum(trace.attempts,'toolStarts'),
          archiveTotalTokens:sum(trace.attempts,'totalTokens'),score:typeof trace.finalText==='string'?scoreDocumentReviewText(trace.finalText):null,
          scope:'fictional office records, Standard mode; observed archive usage not billing'}))
        break
      }
    }
    if(Date.now()>=deadline){console.log(JSON.stringify({stage:'office-result',status:'pending',lastObservedLifecycle:status}));break}
    await sleep(1500)
  }while(true)
}else{process.exitCode=1}
