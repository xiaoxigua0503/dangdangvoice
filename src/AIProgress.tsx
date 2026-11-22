import {useEffect,useState} from 'react';
export interface ReportProgress {phase:string;state:string;terminal:boolean;reportReadable:boolean;preparedImages:number;totalImages:number;createdAt:string;startedAt:string|null;finishedAt:string|null;serverNow:string;retryAt:string|null;waitingForWorker:boolean}
const labels:Record<string,string>={recovering:'等待后台恢复处理',queued:'等待后台处理',prepare:'准备评论与图片',model:'AI 正在分析',persist:'整理并保存报告',completed:'分析完成',partial:'处理已结束 · 部分数据未完成',failed:'分析未完成',cancelled:'已取消',retry:'正在等待重试',fallback:'正在切换可用模型',processing:'后台处理中，等待阶段更新'};
const duration=(ms:number)=>`${Math.max(0,Math.floor(ms/60000))}分 ${Math.max(0,Math.floor(ms/1000)%60)}秒`;
export function AIProgress({progress:p,stale=false}:{progress:ReportProgress;stale?:boolean}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{setElapsed(0);if(p.terminal)return;const from=Date.now();const id=setInterval(()=>setElapsed(Date.now()-from),1000);return()=>clearInterval(id);},[p.serverNow,p.terminal]);
 const now=Date.parse(p.serverNow)+elapsed,end=p.finishedAt?Date.parse(p.finishedAt):now,start=p.startedAt?Date.parse(p.startedAt):null,created=Date.parse(p.createdAt);
 const determinate=p.phase==='prepare'&&p.totalImages>0,completed=p.state==='completed'&&p.reportReadable&&p.terminal;
 const stage=['queued','prepare','model','persist','completed'].indexOf(p.phase);
 return <div className={`ai-pipeline-progress${p.terminal?' terminal':''}`} aria-label="AI 报告进度">
  <p role="status" aria-live="polite">{labels[p.phase]||'等待状态更新'}{stale?' · 状态暂未更新，以最近保存状态为准':''}</p>
  {completed?<progress max={1} value={1} aria-label="分析完成"/>:p.terminal?<div className="ai-progress-ended"/>:determinate?<progress max={p.totalImages} value={p.preparedImages} aria-label="图片准备进度"/>:<div className="ai-progress-wait" role="progressbar" aria-label={labels[p.phase]||'等待状态更新'} aria-valuetext="进度未知"/>}
  {!p.terminal&&<ol aria-label="处理阶段">{['等待处理','准备评论与图片','AI 正在分析','整理并保存报告','分析完成'].map((label,i)=><li key={label} aria-current={i===stage?'step':undefined}>{label}</li>)}</ol>}
  {determinate&&<small>已准备 {p.preparedImages} / {p.totalImages} 张图片（下载准备，不代表 AI 已分析）</small>}
  {p.waitingForWorker&&now-created>60000&&<small>任务尚未被后台接收；刷新会恢复状态，无需再次提交。</small>}
  {p.retryAt&&<small>下次重试时间：{new Date(p.retryAt).toLocaleTimeString('zh-CN')} · 等待 {Math.max(0,Math.ceil((Date.parse(p.retryAt)-now)/1000))}秒</small>}
  <small>{start?`排队 ${duration(start-created)} · 处理历时 ${duration(end-start)}（含重试等待）`:`已等待 ${duration(end-created)}`}</small>
  {p.state==='partial'&&<small>{p.reportReadable?'处理已结束；报告和原始来源仍可阅读，未完成范围见下方说明。':'处理已结束；已保存来源保持可读，结果范围见下方说明。'}</small>}
 </div>;
}
