import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {AIChatAnswer,sourceLabel} from './AIChatAnswer';
import type {ChatReference,ChatSource} from './AIChatAnswer';
import {AIChatEvidence} from './AIChatEvidence';
const post=<T,>(path:string,body:unknown,signal:AbortSignal)=>api<T>(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
interface Turn {id:string;ordinal:number;question:string;image_ids?:string[]|null;purpose?:string;state:string;result:{text:string;references:ChatReference[]}|null;error:string|null;actual_model:string|null;scope:{comments:number;commentsTotal:number;images:number;imagesTotal:number;imageIds?:string[];deliveredImageIds?:string[];deliveryConfirmed?:boolean;deliveryMode?:'mock'|'provider';historyIncluded:number;historyOmitted:number;sourceNotice?:string[]}|null}
interface Chat {conversation:{id:string;runId:string;mock:boolean}|null;sessionId?:string|null;sessions?:{id:string;created_at:string}[];turns:Turn[];catalog?:{id:string;available:boolean;comments:string[]}[];sources?:Record<string,ChatSource>;limits?:{questionChars:number;images:number;historyTurns:number}}
interface Submission {requestId:string;question:string;imageIds:string[];purpose:string;sessionId?:string}
const purposes=[['unspecified','不指定'],['beginner','入门阅读'],['research','深入研究'],['gift','送礼'],['collection','收藏']];
export function AIChat({jobId,runId,name}:{jobId:string;runId:string;name:string}){
 const [chat,setChat]=useState<Chat>({conversation:null,turns:[]}),[question,setQuestion]=useState(''),[images,setImages]=useState<string[]>([]),[purpose,setPurpose]=useState('unspecified'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[session,setSession]=useState(''),[selection,setSelection]=useState<ChatReference|null>(null);
 const lifetime=useRef(new AbortController()),posting=useRef(false),composition=useRef(false),uncertain=useRef<Submission|null>(null),textarea=useRef<HTMLTextAreaElement>(null);
 const [retry,setRetry]=useState(0),[uncertainSend,setUncertainSend]=useState(false);
 const active=chat.turns.find(t=>['pending','running','stopping'].includes(t.state));
 const root=`/api/ai/jobs/${jobId}/chat`,disabled=busy||!!active||uncertainSend;
 const sources=chat.sources||{},imageLimit=chat.limits?.images||4;
 useEffect(()=>{
  const c=new AbortController();lifetime.current=c;let timer:ReturnType<typeof setTimeout>;
  async function load(){try{const value=await api<Chat>(root+(session?'?session='+encodeURIComponent(session):''),{signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});if(c.signal.aborted)return;setChat(value);setLoaded(true);if(uncertain.current&&value.turns.some(t=>t.id===uncertain.current?.requestId)){uncertain.current=null;setUncertainSend(false);setQuestion('');setImages([]);setError('');}if(value.turns.some(t=>['pending','running','stopping'].includes(t.state)))timer=setTimeout(()=>void load(),2000);}catch(e){if(!c.signal.aborted){setError((e as Error).message);timer=setTimeout(()=>void load(),5000);}}}
  void load();return()=>{c.abort();clearTimeout(timer);};
 },[root,retry,session]);
 async function send(replay=false){
  if(posting.current||active||!question.trim()||!loaded)return;
  posting.current=true;setBusy(true);setError('');
  const body=replay&&uncertain.current?uncertain.current:{requestId:crypto.randomUUID(),question:question.trim(),imageIds:images,purpose,...(chat.sessionId?{sessionId:chat.sessionId}:{})};
  const signal=lifetime.current.signal;let submitting=false;
  try{
   if(!replay)await post(`${root}/preflight`,body,signal);
   if(signal.aborted)return;uncertain.current=body;submitting=true;
   await post(root,body,signal);if(signal.aborted)return;
   uncertain.current=null;setUncertainSend(false);setQuestion('');setImages([]);setRetry(v=>v+1);
  }catch(e){if(!signal.aborted){setError((e as Error).message);const status=(e as Error & {status?:number}).status;if(!submitting||(status&&status<500)){uncertain.current=null;setUncertainSend(false);}else setUncertainSend(true);}}
  finally{if(!signal.aborted){posting.current=false;setBusy(false);}}
 }
 async function stop(){if(!active||busy)return;setBusy(true);const signal=lifetime.current.signal;try{await post(`${root}/${active.id}/cancel`,{},signal);if(!signal.aborted){setError('');setRetry(v=>v+1);}}catch(e){if(!signal.aborted)setError((e as Error).message);}finally{if(!signal.aborted)setBusy(false);}}
 async function newSession(){if(disabled)return;setBusy(true);const signal=lifetime.current.signal;try{const r=await post<{sessionId:string}>(`${root}/sessions`,{sessionId:crypto.randomUUID()},signal);if(!signal.aborted){setSession(r.sessionId);setChat(current=>({...current,turns:[],sessionId:r.sessionId}));setLoaded(false);setError('');}}catch(e){if(!signal.aborted)setError((e as Error).message);}finally{if(!signal.aborted)setBusy(false);}}
 function askImage(id:string){if(disabled)return;setImages([id]);setQuestion('这张买家图片能看出哪些细节？哪些仍需确认？');setError('');textarea.current?.focus();}
 function toggleImage(id:string){setError('');setImages(current=>current.includes(id)?current.filter(i=>i!==id):current.length<imageLimit?[...current,id]:current);}
 return <section className="ai-chat" aria-label="问问 DiDi">
  <header><h3 className="serif">问问 DiDi</h3><p>正在讨论：《{name}》</p></header>
  {chat.conversation?.mock&&<p className="ai-warning">本地 mock 演示，未进行真实 AI 推理。</p>}
  {chat.catalog?.some(i=>!i.available)&&<p className="ai-warning">部分图片未下载或无法读取，不能选入本轮。</p>}
  <div className="ai-chat-toolbar"><button className="ghost-btn" disabled={disabled||!loaded} onClick={()=>void newSession()}>开始新对话</button>{(chat.sessions?.length||0)>1&&<label>已保存对话 <select aria-label="已保存对话" value={chat.sessionId||''} disabled={disabled} onChange={e=>{setSession(e.target.value);setChat(v=>({...v,turns:[]}));setLoaded(false);setSelection(null);setError('');}}>{chat.sessions?.map((s,i)=><option key={s.id} value={s.id}>对话 {i+1} · {new Date(s.created_at).toLocaleString('zh-CN')}</option>)}</select></label>}</div>
  {!loaded&&<p role="status">正在读取对话…</p>}
  {!chat.turns.length&&<div className="chips">{['适合入门阅读吗？','买家反映了哪些问题？','这个版本有哪些细节需要确认？'].map(q=><button key={q} className="chip" disabled={!loaded||disabled} onClick={()=>setQuestion(q)}>{q}</button>)}</div>}
  <div className="ai-chat-messages" role="log" aria-label="产品问答记录" aria-live="polite" aria-relevant="additions text">
   {chat.turns.map(turn=><div className="ai-chat-turn" key={turn.id}><p className="ai-chat-question"><b>你</b><span>{turn.question}</span></p>
    {turn.result?<div className="ai-chat-answer"><b>DiDi</b><AIChatAnswer text={turn.result.text} references={turn.result.references} sources={sources} open={setSelection}/></div>:<p role="status">{turn.state==='pending'?'正在等待回答…':turn.state==='running'?'DiDi 正在回答…':turn.state==='stopping'?'正在停止回答…':turn.state==='cancelled'?'已停止，此轮不会自动重试。':turn.error||'回答未完成。'}{turn.state==='failed'&&<button className="ghost-btn" disabled={disabled} onClick={()=>{setQuestion(turn.question);setImages(turn.image_ids||[]);setPurpose(turn.purpose||'unspecified');}}>重新提问</button>}</p>}
    {!!turn.scope?.sourceNotice?.length&&<p className="ai-warning">{turn.scope.sourceNotice.join('；')}</p>}
    {turn.scope&&<details className="ai-chat-basis"><summary>本轮依据</summary><p>快照评论：{turn.scope.comments}/{turn.scope.commentsTotal} 条。{turn.scope.deliveryMode==='mock'?`仅 mock 输入包含 ${turn.scope.deliveredImageIds?.length||0} 张图片，未调用真实模型`:turn.scope.deliveryConfirmed?`模型已接收 ${turn.scope.deliveredImageIds?.length||0} 张图片`:`${turn.scope.images} 张计划输入图片；旧记录或未完成请求无法确认实际接收`} / 快照共 {turn.scope.imagesTotal} 张。</p>{turn.scope.deliveryConfirmed&&!turn.scope.deliveredImageIds?.length&&<p>本轮未查看图片；旧报告中的图片描述仅供参考。</p>}<p>历史窗口：最近 {turn.scope.historyIncluded} 轮已完成回答；另 {turn.scope.historyOmitted} 轮未发送，全部历史仍保存在对应对话。</p><p>目的：{purposes.find(([id])=>id===turn.purpose)?.[1]||'不指定'}{turn.actual_model?` · 模型：${turn.actual_model}`:''}</p><p>快照：{runId}</p>{turn.result?.references.filter(r=>r.type==='comment').map(ref=><p key={ref.type+ref.id}>{sourceLabel(ref,sources)} · {sources[ref.id]?.versionStatus||'版本未确认'}{sources[ref.id]?.sourceProductId?` · 来源商品 #${sources[ref.id].sourceProductId}`:''}</p>)}</details>}
   </div>)}
  </div>
  {error&&<div className="ai-status-message" role="alert"><p>{error}</p><button className="ghost-btn" disabled={busy} onClick={()=>uncertainSend?void send(true):setRetry(v=>v+1)}>{uncertainSend?'重试提交（同一请求）':'重新读取'}</button>{!uncertainSend&&<button className="ghost-btn" disabled={disabled} onClick={()=>void newSession()}>开始新对话（保留草稿）</button>}</div>}
  <form onSubmit={e=>{e.preventDefault();void send();}}>
   <label htmlFor="didi-purpose">购买目的（可选） <select id="didi-purpose" value={purpose} disabled={disabled} onChange={e=>setPurpose(e.target.value)}>{purposes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <details className="ai-chat-picker"><summary>选择已保存图片 · 已选 {images.length} 张（最多 {imageLimit} 张）</summary><p>只使用这份快照已保存的图片，不重新采集。不选图片时，本轮不会查看图片。</p><div className="ai-chat-image-grid">{chat.catalog?.filter(i=>i.available).map(image=><div className={`ai-chat-image-option${images.includes(image.id)?' selected':''}`} key={image.id}><label><input aria-label={`选择图片 ${image.id}`} type="checkbox" checked={images.includes(image.id)} disabled={disabled||(!images.includes(image.id)&&images.length>=imageLimit)} onChange={()=>toggleImage(image.id)}/><img loading="lazy" src={`/api/ai/jobs/${jobId}/image/${encodeURIComponent(image.id)}`} alt={`已保存买家图片 · ${image.comments.join('、')}`}/><span>{image.comments.join('、')||'未记录关联评论'}</span></label><button type="button" className="ghost-btn" disabled={disabled} onClick={()=>askImage(image.id)}>问问 DiDi</button><button type="button" className="ghost-btn" onClick={()=>setSelection({type:'image',id:image.id})}>查看原图</button></div>)}</div>{!chat.catalog?.some(i=>i.available)&&<p>这份快照没有可用的已保存图片。</p>}</details>
   <label htmlFor="didi-question">你想了解什么？</label>
   <textarea ref={textarea} id="didi-question" value={question} maxLength={chat.limits?.questionChars||2000} rows={3} disabled={disabled} onChange={e=>setQuestion(e.target.value)} onCompositionStart={()=>{composition.current=true;}} onCompositionEnd={()=>{composition.current=false;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composition.current&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}}/>
   <div className="ai-chat-controls"><span>已选 {images.length} 张</span><button className="go" type="submit" disabled={!loaded||disabled||!question.trim()}>{busy?'正在提交…':'发送'}</button>{active&&<button className="ghost-btn" type="button" disabled={busy} onClick={()=>void stop()}>停止回答</button>}</div>
   <small>Enter 发送 · Shift+Enter 换行。每轮保留全部快照评论，历史按最近 {chat.limits?.historyTurns||8} 轮窗口发送；选择图片或目的不会调用 AI。</small>
  </form>
  {selection&&<AIChatEvidence jobId={jobId} selection={selection} close={()=>setSelection(null)} open={setSelection} ask={askImage} canAsk={!disabled}/>}
 </section>;
}
