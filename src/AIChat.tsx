import {useEffect,useRef,useState} from 'react';
import {api} from './api';
const post=(path:string,body:unknown,signal:AbortSignal)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
interface Reference {type:'comment'|'image';id:string}
interface Turn {id:string;ordinal:number;question:string;use_images:boolean;state:string;result:{text:string;references:Reference[]}|null;error:string|null;actual_model:string|null;scope:{comments:number;commentsTotal:number;images:number;imagesTotal:number;historyIncluded:number;historyOmitted:number;sourceNotice?:string[]}|null}
interface Chat {conversation:{id:string;runId:string;mock:boolean}|null;turns:Turn[];limits?:{questionChars:number;images:number}}
export function AIChat({jobId,runId,name,showEvidence}:{jobId:string;runId:string;name:string;showEvidence:(kind:string,id:string)=>void}){
 const [chat,setChat]=useState<Chat>({conversation:null,turns:[]}),[question,setQuestion]=useState(''),[images,setImages]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const lifetime=useRef(new AbortController()),posting=useRef(false),composition=useRef(false),uncertain=useRef<{requestId:string;question:string;useImages:boolean}|null>(null);
 const [retry,setRetry]=useState(0),[uncertainSend,setUncertainSend]=useState(false);
 const active=chat.turns.find(t=>['pending','running','stopping'].includes(t.state));
 const root=`/api/ai/jobs/${jobId}/chat`;
 useEffect(()=>{
  const c=new AbortController();lifetime.current=c;let timer:ReturnType<typeof setTimeout>;
  async function load(){try{const value=await api<Chat>(root,{signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});if(c.signal.aborted)return;setChat(value);setLoaded(true);if(!uncertain.current)setError('');if(uncertain.current&&value.turns.some(t=>t.id===uncertain.current?.requestId)){uncertain.current=null;setUncertainSend(false);setQuestion('');setError('');}if(value.turns.some(t=>['pending','running','stopping'].includes(t.state)))timer=setTimeout(()=>void load(),2000);}catch(e){if(!c.signal.aborted){setError((e as Error).message);timer=setTimeout(()=>void load(),5000);}}}
  void load();return()=>{c.abort();clearTimeout(timer);};
 },[root,retry]);
 async function send(text=question,replay=false){
  const value=text.trim();if(posting.current||active||!value||!loaded)return;
  posting.current=true;setBusy(true);setError('');
  const body=replay&&uncertain.current?uncertain.current:{requestId:crypto.randomUUID(),question:value,useImages:images};uncertain.current=body;
  const signal=lifetime.current.signal;
  try{await post(root,body,signal);if(signal.aborted)return;uncertain.current=null;setUncertainSend(false);setQuestion('');setRetry(v=>v+1);}catch(e){if(!signal.aborted){setError((e as Error).message);const status=(e as Error & {status?:number}).status;if(status&&status<500){uncertain.current=null;setUncertainSend(false);}else setUncertainSend(true);}}finally{if(!signal.aborted){posting.current=false;setBusy(false);}}
 }
 async function stop(){if(!active||busy)return;setBusy(true);const signal=lifetime.current.signal;try{await post(`${root}/${active.id}/cancel`,{},signal);if(!signal.aborted)setRetry(v=>v+1);}catch(e){if(!signal.aborted)setError((e as Error).message);}finally{if(!signal.aborted)setBusy(false);}}
 return <section className="ai-chat" aria-label="问问 DiDi">
  <header><h3 className="serif">问问 DiDi</h3><p>当前问答：{name} · 快照 <code>{runId}</code></p><small>仅依据这份报告对应的已保存资料。默认读取全部快照评论；图片按需选择。</small></header>
  {chat.conversation?.mock&&<p className="ai-warning">本地 mock 演示，未进行真实 AI 推理。</p>}
  {!chat.turns.length&&<div className="chips">{['适合入门阅读吗？','买家反映了哪些问题？','这个版本有哪些细节需要确认？'].map(q=><button key={q} className="chip" disabled={!loaded||busy||!!active||uncertainSend} onClick={()=>setQuestion(q)}>{q}</button>)}</div>}
  <div className="ai-chat-messages" role="log" aria-label="产品问答记录" aria-live="polite" aria-relevant="additions text">
   {chat.turns.map(turn=><div className="ai-chat-turn" key={turn.id}><p className="ai-chat-question"><b>你</b><span>{turn.question}</span></p>
    {turn.result?<div className="ai-chat-answer"><b>DiDi</b><p>{turn.result.text}</p><div className="chips">{turn.result.references.map((ref,i)=><button className="chip" key={ref.type+ref.id+i} onClick={()=>showEvidence(ref.type,ref.id)}>{ref.type==='comment'?'查看原评':'查看图片'} · {ref.id}</button>)}</div></div>:<p role="status">{turn.state==='pending'?'正在等待回答…':turn.state==='running'?'DiDi 正在回答…':turn.state==='stopping'?'正在停止回答…':turn.state==='cancelled'?'已停止，此轮不会自动重试。':turn.error||'回答未完成。'}{turn.state==='failed'&&<button className="ghost-btn" disabled={busy||!!active||uncertainSend} onClick={()=>{setQuestion(turn.question);setImages(turn.use_images);}}>重新提问</button>}</p>}
    {turn.scope&&<small className="ai-chat-scope">本轮范围：{turn.scope.comments}/{turn.scope.commentsTotal} 条快照评论 · {turn.scope.images}/{turn.scope.imagesTotal} 张图片（{turn.scope.images?'所选图片子集':'未查看图片像素'}）。发送最近 {turn.scope.historyIncluded} 轮已完成历史{turn.scope.historyOmitted>0?`，另 ${turn.scope.historyOmitted} 轮未发给模型，仍完整保存在此`:'；历史完整保存在此'}。{turn.scope.sourceNotice?.join('；')}{turn.actual_model?` · 模型：${turn.actual_model}`:''}</small>}
   </div>)}
  </div>
  {error&&<p className="ai-status-message" role="alert">{error} <button className="ghost-btn" disabled={busy} onClick={()=>uncertainSend?void send(uncertain.current?.question||question,true):setRetry(v=>v+1)}>{uncertainSend?'重试提交（同一请求）':'重新读取'}</button></p>}
  <form onSubmit={e=>{e.preventDefault();void send();}}>
   <label htmlFor="didi-question">关于这份商品快照，你想了解什么？</label>
   <textarea id="didi-question" value={question} maxLength={chat.limits?.questionChars||2000} rows={3} disabled={busy||!!active||uncertainSend} onChange={e=>setQuestion(e.target.value)} onCompositionStart={()=>{composition.current=true;}} onCompositionEnd={()=>{composition.current=false;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composition.current&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}}/>
   <div className="ai-chat-controls"><label><input type="checkbox" checked={images} disabled={busy||!!active||uncertainSend} onChange={e=>setImages(e.target.checked)}/> 结合已保存的相关图片（最多 {chat.limits?.images||4} 张）</label><button className="go" type="submit" disabled={!loaded||busy||!!active||!question.trim()||uncertainSend}>发送</button>{active&&<button className="ghost-btn" type="button" disabled={busy} onClick={()=>void stop()}>停止回答</button>}</div>
   <small>Enter 发送 · Shift+Enter 换行。回答仅供参考，可打开原评与图片核对。</small>
  </form>
 </section>;
}
