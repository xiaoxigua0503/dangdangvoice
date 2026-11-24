import { useEffect, useState, useRef } from "react";
import { api, postJson, buildCsvLocal } from "./api";
import type {ReactNode} from "react";
import type { ArchiveEntry } from "./api";
export interface User {
  id: string;
  email: string;
  verified: boolean;
  plan?: "free" | "pro" | "enterprise";
  role?: "user" | "admin";
  proExpiresAt?: string|null;
}
export function Account({user,onChange,open,setOpen,children}:{user:User|null;onChange:(u:User|null)=>void;open:boolean;setOpen:(v:boolean)=>void;children?:ReactNode}) {
 const [msg,setMsg]=useState('');
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open,setOpen]);
 return <div className="header-account" id="account" ref={root} onBlur={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
  {user?<><button ref={trigger} className="account-trigger" aria-label="账户设置" aria-expanded={open} aria-controls="account-dropdown" onClick={()=>setOpen(!open)}><span aria-hidden="true">◉</span><small>{user.plan==='enterprise'?'Enterprise':user.plan==='pro'?'Pro':'Free'}</small></button>
  {open&&<div className="account-dropdown" id="account-dropdown"><b>账户设置</b><p className="account-email">{user.email}</p><p>{user.verified?'邮箱已验证':'邮箱待验证'} · {user.plan==='enterprise'?'Enterprise 企业版':user.plan==='pro'?'Pro 会员':'Free 套餐'}</p>{user.proExpiresAt&&<p>有效期至 {new Date(user.proExpiresAt).toLocaleDateString('zh-CN')}</p>}{user.role==='admin'&&<a href="/admin">管理后台</a>}<a href="/forgot-password">重置密码</a>{!user.verified&&<a href="/verify-email">验证邮箱</a>}<button className="ghost-btn" onClick={async()=>{try{await postJson('/api/auth/logout',{});onChange(null);new BroadcastChannel('ddv-account-changed').postMessage({changed:true});location.replace('/login');}catch(e){setMsg((e as Error).message);}}}>退出登录</button>{msg&&<p role="status">{msg}</p>}{children}</div>}</>:<div className="account-guest"><a href="/login">登录</a><a href="/register">注册</a></div>}
 </div>;
}

interface CloudRow {
  id: string;
  pid: string;
  name: string;
  source: string;
  created_at: string;
  comments_count: string;
}
export function CloudHistory({
  user,
  onOpen,
}: {
  user: User;
  onOpen: (e: ArchiveEntry) => void;
}) {
  const [q, setQ] = useState(""),
    [source, setSource] = useState(""),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<CloudRow[]>([]),
    [total, setTotal] = useState(0),
    [msg, setMsg] = useState(""),
    [rev, setRev] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setRows([]);
    void api<{ rows: CloudRow[]; total: number }>(
      `/api/history?q=${encodeURIComponent(q)}&source=${source}&page=${page}`,
      { signal: c.signal },
    )
      .then((r) => {
        if(c.signal.aborted)return;
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!c.signal.aborted) setMsg(e.message);
      });
    return () => c.abort();
  }, [q, source, page, rev]);
  useEffect(() => {
    const f = () => setRev((v) => v + 1);
    window.addEventListener("ddv-cloud-saved", f);
    return () => window.removeEventListener("ddv-cloud-saved", f);
  }, []);
  // Abort outstanding restores and exports when this account component unmounts.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const alive = useRef(true);
  async function load(id: string, format?: string) {
    try {
      const e = await api<ArchiveEntry>("/api/history/" + id);
      if (!alive.current) return;
      if (!format) {
        onOpen(e);
        return;
      }
      const text =
        format === "csv"
          ? buildCsvLocal(e.product.pid, e.product.name || "", e.comments)
          : JSON.stringify(e, null, 2);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([text], {
          type:
            format === "csv" ? "text/csv;charset=utf-8" : "application/json",
        }),
      );
      a.download = `dangdangvoice_${id}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      if (alive.current) setMsg((e as Error).message);
    }
  }
  return (
    <section className="cloud-history">
      <h3>云端历史</h3>

      <div className="lib-filter">
        <label>
          搜索商品或评论
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          来源
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部</option>
            <option value="relay">在线采集</option>
            <option value="import">导入</option>
            <option value="sample">样例</option>
          </select>
        </label>
      </div>
      <p role="status">{msg}</p>
      {rows.map((r) => (
        <article className="cloud-row" key={r.id}>
          <div>
            <b>{r.name || r.pid}</b>
            <small>
              {" "}
              #{r.pid} · {r.comments_count} 条 ·{" "}
              {new Date(r.created_at).toLocaleString("zh-CN")}
            </small>
          </div>
          <div className="chips">
            <button className="chip" onClick={() => void load(r.id)}>
              打开分析
            </button>
            <details className="export-menu"><summary>导出</summary><button className="chip" onClick={() => void load(r.id, "csv")}>CSV</button>
            <button className="chip" onClick={() => void load(r.id, "json")}>
              完整 JSON
            </button></details><details className="record-more"><summary>更多</summary>
            <button
              className="chip"
              onClick={async () => {
                if (!confirm("确定删除这份云端记录及其评论？此操作无法撤销。"))
                  return;
                try {
                  await api("/api/history/" + r.id, {
                    method: "DELETE",
                    headers: { "content-type": "application/json" },
                  });
                  if (alive.current) setRev((v) => v + 1);
                } catch (e) {
                  if (alive.current) setMsg((e as Error).message);
                }
              }}
            >
              删除记录
            </button></details>
          </div>
        </article>
      ))}
      <div className="pager">
        <button
          className="ghost-btn"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        <span>
          {page} 页 · {total} 份记录
        </span>
        <button
          className="ghost-btn"
          disabled={page * 20 >= total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
