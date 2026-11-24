import {useEffect,useRef,useState} from 'react';
import {Enterprise} from './Enterprise';
import {App} from './App';
import {Admin} from './Admin';
import type {User} from './Account';
import {api,postJson,initializeCsrf} from './api';
const routes:Record<string,{title:string;action:string}>={
 '/login':{title:'登录当当之声',action:'login'},'/register':{title:'创建账户',action:'signup'},'/forgot-password':{title:'找回密码',action:'forgot'},'/reset-password':{title:'设置新密码',action:'reset'},'/verify-email':{title:'验证邮箱',action:'resend'}
};
export function Entry(){
 const legacy=new URL(location.href).searchParams.get('auth');
 if(location.pathname==='/'&&['verify','reset'].includes(legacy||'')){
  location.replace((legacy==='verify'?'/verify-email':'/reset-password')+location.hash);
 }
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const seq=useRef(0),path=location.pathname;
 const home=(u:User)=>u.role==='admin'?'/admin':u.plan==='enterprise'?'/enterprise':'/app';
 useEffect(()=>{
 let mounted=true;
 const refresh=async()=>{const n=++seq.current;try{const r=await api<{user:User|null}>('/api/auth/me');if(mounted&&n===seq.current){setError('');setUser(r.user);setLoading(false);}}catch(e){if(mounted&&n===seq.current){setError((e as Error).message);setLoading(false);}}};
 void refresh();const c=new BroadcastChannel('ddv-account-changed');c.onmessage=()=>void refresh();
 const timer=setInterval(()=>void refresh(),60000);const f=()=>void refresh();window.addEventListener('focus',f);window.addEventListener('ddv-auth-expired',f);
 return()=>{mounted=false;seq.current++;c.close();clearInterval(timer);window.removeEventListener('focus',f);window.removeEventListener('ddv-auth-expired',f);};
 },[]);
 if(loading)return <div className="auth-loading">当当之声 · 正在确认账户…</div>;
 if(user&&['/','/login','/register'].includes(path)){location.replace(home(user));return null;}
 if(!user&&!routes[path]){location.replace('/login');return null;}
 if(user&&path==='/admin'&&user.role!=='admin'){location.replace('/app');return null;}
 if(user&&path==='/enterprise'&&user.plan!=='enterprise'){location.replace('/app');return null;}
 if(user&&user.plan==='enterprise'&&['/app','/enterprise'].includes(path))return <Enterprise key={user.id+user.plan} user={user} onUser={u=>{seq.current++;setUser(u);}}/>;
 if(user&&path==='/app')return <App key={user.id} sessionUser={user} onSessionChange={u=>{seq.current++;setUser(u);}}/>;
 if(user&&path==='/admin')return <Admin user={user} onLogout={()=>{seq.current++;setUser(null);location.replace('/login');}}/>;
 if(!routes[path]){location.replace(user?home(user):'/login');return null;}
 return <AuthScreen key={path} path={path} error={error} onUser={u=>{seq.current++;setUser(u);location.replace(home(u));}}/>;
}
function AuthScreen({path,error,onUser}:{path:string;error:string;onUser:(u:User)=>void}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const [token]=useState(()=>location.hash.slice(1));
 useEffect(()=>{if(location.hash)history.replaceState(null,'',location.pathname);const c=new AbortController();void initializeCsrf(c.signal).catch(e=>{if(!c.signal.aborted)setMsg(e.message);});return()=>c.abort();},[]);
 const def=routes[path],action=path==='/verify-email'&&token?'verify':def.action;
 return <main className="auth-shell"><aside className="auth-story"><a className="auth-brand" href="/login">当当之声<span>倾听真实的购买体验</span></a><h1>每条评论，<br/>都有值得听见的声音。</h1><p>从基础声纹到深度洞察，<br/>把商品评价变成清晰的购买与经营依据。</p><div className="auth-wave" aria-hidden="true">▂ ▅ ▃ █ ▄ ▇ ▂ ▅ ▃ █ ▄ ▆ ▂</div></aside><section className="auth-card"><p className="eyebrow">欢迎来到当当之声</p><h2>{def.title}</h2><p>{path==='/login'?'登录后开始采集，保存你的分析与报告。':'使用你的邮箱安全管理账户。'}</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setMsg('');try{const r=await postJson<{user?:User;msg?:string}>('/api/auth/'+action,{email,password,token});setPassword('');setMsg(r.msg||'操作成功');if(r.user){new BroadcastChannel('ddv-account-changed').postMessage({changed:true});onUser(r.user);}}catch(e){setMsg((e as Error).message);}finally{setBusy(false);}}}>
 {!['verify','reset'].includes(action)&&<label>邮箱地址<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="支持 Gmail、QQ 邮箱、163 邮箱等"/></label>}
 {['login','signup','reset'].includes(action)&&<label>密码<input required type="password" minLength={12} maxLength={128} autoComplete={action==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/><small>12–128 个字符</small></label>}
 {action==='reset'&&!token&&<p role="alert">链接缺少令牌，请重新申请重置邮件。</p>}
 <button className="go" disabled={busy||(action==='reset'&&!token)}>{busy?'处理中…':action==='verify'?'确认验证邮箱':action==='resend'?'发送 / 重发验证邮件':action==='forgot'?'发送重置邮件':action==='reset'?'保存新密码':action==='signup'?'注册账户':'登录'}</button><p role="status">{msg||error}</p></form><nav className="auth-links"><a href="/login">登录</a><a href="/register">注册账户</a><a href="/forgot-password">忘记密码</a><a href="/verify-email">验证邮箱</a></nav>{path!=='/login'&&<p className="muted">邮件链接限时有效且仅可使用一次；请同时检查垃圾邮件箱。</p>}</section></main>;
}
