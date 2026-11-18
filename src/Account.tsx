import { useEffect, useState, useRef } from "react";
import { api, postJson, buildCsvLocal } from "./api";
import type { ArchiveEntry } from "./api";
export interface User {
  id: string;
  email: string;
  verified: boolean;
  plan?: "free" | "pro";
  role?: "user" | "admin";
  proExpiresAt?: string|null;
}
export function Account({user,onChange,open,setOpen}:{user:User|null;onChange:(u:User|null)=>void;open:boolean;setOpen:(v:boolean)=>void}) {
 const [msg,setMsg]=useState('');
 return <section className="account-panel" id="account"><div className="account-line"><b>我的账户</b><small className="plan-badge">{user?.plan==='pro'?'Pro':'Free'}</small><span>{user?.email} · {user?.verified?'邮箱已验证':'邮箱待验证'}</span><button className="ghost-btn" onClick={()=>setOpen(!open)}>账户设置</button></div>{open&&<div className="account-form">{user?.role==='admin'&&<a href="/admin">管理后台</a>}<a href="/forgot-password">重置密码</a>{!user?.verified&&<a href="/verify-email">验证邮箱</a>}<button className="ghost-btn" onClick={async()=>{try{await postJson('/api/auth/logout',{});onChange(null);new BroadcastChannel('ddv-account-changed').postMessage({changed:true});location.replace('/login');}catch(e){setMsg((e as Error).message);}}}>退出登录</button><p role="status">{msg}</p></div>}</section>;
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
  onCopy,
}: {
  user: User;
  onOpen: (e: ArchiveEntry) => void;
  onCopy: () => void;
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
      <h3>云端历史 · {user.email}</h3>
      <p>仅当前账户可见；本浏览器档案在下方单独展示，不会自动上传。</p>
      <button className="ghost-btn" disabled={!user.verified} onClick={onCopy}>
        将本浏览器档案复制到此账户
      </button>
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
              恢复声纹台
            </button>
            <button className="chip" onClick={() => void load(r.id, "csv")}>
              CSV
            </button>
            <button className="chip" onClick={() => void load(r.id, "json")}>
              完整 JSON
            </button>
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
              删除
            </button>
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
