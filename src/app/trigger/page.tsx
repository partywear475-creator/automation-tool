"use client";

import { useEffect, useState } from "react";

interface WF {
  id: string;
  name: string;
  brand: string;
  trigger: string;
}

// Handy starter inputs for the form/manual workflows that take a body.
const SAMPLE_BODY: Record<string, string> = {
  "cocogrove-caption-assistant": '{\n  "dishName": "Kerala prawn roast",\n  "postType": "feed"\n}',
  "nianova-instagram-auto-post": '{\n  "imageUrl": "https://...",\n  "caption": "..."\n}',
  "emberwolf-episode-generator": '{\n  "topic": "...",\n  "pillar": "...",\n  "duration": 30\n}',
};

export default function TriggerPage() {
  const [workflows, setWorkflows] = useState<WF[]>([]);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [body, setBody] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<"" | "ok" | "err">("");

  useEffect(() => {
    try {
      const s = sessionStorage.getItem("cron_secret");
      if (s) setSecret(s);
    } catch {}
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d) => {
        const list: WF[] = d.workflows || [];
        setWorkflows(list);
        const first = list.find((w) => w.id === "cocogrove-caption-assistant") || list[0];
        if (first) {
          setId(first.id);
          setBody(SAMPLE_BODY[first.id] ?? "");
        }
      })
      .catch(() => {});
  }, []);

  function onPick(newId: string) {
    setId(newId);
    setBody(SAMPLE_BODY[newId] ?? "");
    setResult("");
    setStatus("");
  }

  async function run() {
    setRunning(true);
    setResult("");
    setStatus("");
    try {
      sessionStorage.setItem("cron_secret", secret);
    } catch {}

    let parsed: unknown = undefined;
    if (body.trim()) {
      try {
        parsed = JSON.parse(body);
      } catch {
        setRunning(false);
        setStatus("err");
        setResult("The input box is not valid JSON. Fix it or clear it.");
        return;
      }
    }

    try {
      const res = await fetch(`/api/workflows/${id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: parsed ? JSON.stringify(parsed) : undefined,
      });
      const json = await res.json();
      setStatus(res.ok && json.status === "success" ? "ok" : "err");
      setResult(JSON.stringify(json, null, 2));
    } catch (e) {
      setStatus("err");
      setResult(e instanceof Error ? e.message : String(e));
    }
    setRunning(false);
  }

  const selected = workflows.find((w) => w.id === id);

  return (
    <div className="wrap" style={{ maxWidth: 680 }}>
      <h1>Run a workflow</h1>
      <p className="sub">
        Pick a workflow, paste your CRON_SECRET once, and run it. Results also appear on the{" "}
        <a href="/">dashboard</a>.
      </p>

      <div className="card" style={{ padding: 18 }}>
        <label className="lbl">Workflow</label>
        <select className="inp" value={id} onChange={(e) => onPick(e.target.value)}>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.trigger})
            </option>
          ))}
        </select>

        <label className="lbl">CRON_SECRET</label>
        <input
          className="inp mono"
          type="password"
          placeholder="paste your secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />

        <label className="lbl">
          Input (JSON) <span className="muted">— only needed for form workflows; clear it otherwise</span>
        </label>
        <textarea
          className="inp mono"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="{ }"
        />

        <button className="btn" disabled={running || !id || !secret} onClick={run}>
          {running ? "Running…" : `Run ${selected ? selected.name : ""}`}
        </button>
      </div>

      {status && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div className={`badge ${status === "ok" ? "success" : "error"}`} style={{ marginBottom: 10 }}>
            {status === "ok" ? "success" : "error"}
          </div>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12.5 }}>
            {result}
          </pre>
        </div>
      )}

      <style>{`
        .lbl { display:block; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin:14px 0 6px; font-weight:600; }
        .inp { width:100%; background:var(--panel-2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:9px 11px; font-size:13.5px; font-family:inherit; }
        textarea.inp { resize:vertical; }
        .btn { margin-top:18px; width:100%; background:var(--accent); color:#06281d; border:none; border-radius:8px; padding:11px; font-size:14px; font-weight:700; cursor:pointer; }
        .btn:disabled { opacity:0.5; cursor:not-allowed; }
      `}</style>
    </div>
  );
}
