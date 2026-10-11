"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, KeyRound, Loader2, CheckCircle2, ShieldCheck, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { recoveryFetch } from "@/lib/admin-recovery-client";

/**
 * "What is my childhood nickname?" — the owner sets their answer once and it is
 * hidden for good. Only a scrypt hash ever leaves the browser, and no API
 * returns it afterwards, so there is deliberately no "show my answer" control:
 * the only honest way to change it is to set a new one.
 */
const QUESTION = "What is my childhood nickname?";

type Status = {
  configured: boolean;
  question: string | null;
  locked: boolean;
  lockRemainingMs: number;
  attemptsRemaining: number;
};

export default function AdminRecoveryPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPw, setCurrentPw] = useState("");
  const [answer, setAnswer] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await recoveryFetch("/api/admin/recovery", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!currentPw) {
      setMsg({ ok: false, text: "Enter your current admin password first." });
      return;
    }
    if (!answer.trim()) {
      setMsg({ ok: false, text: "Enter your answer." });
      return;
    }
    if (answer.trim().toLowerCase() !== confirm.trim().toLowerCase()) {
      setMsg({ ok: false, text: "Answer and confirmation do not match." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await recoveryFetch("/api/admin/recovery", {
        method: "POST",
        body: JSON.stringify({ action: "setup", currentPassword: currentPw, answer, confirmAnswer: confirm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || "Could not save your answer.");
      setCurrentPw(""); setAnswer(""); setConfirm("");
      setMsg({ ok: true, text: "Answer saved. It is now hidden — you will never see it again here." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save your answer." });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <p className="text-xs text-muted">Loading recovery settings…</p>
      </div>
    );
  }

  const configured = status?.configured === true;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
          <HelpCircle className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Forgotten Password</h2>
          <p className="text-[10px] text-muted">Recover admin access with your security answer</p>
        </div>
        {configured && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-semibold text-success">
            <ShieldCheck className="h-3 w-3" /> Set up
          </span>
        )}
      </div>

      {configured ? (
        <>
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-success/25 bg-success/10 px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div className="text-xs">
              <p className="font-semibold text-success">Recovery is active</p>
              <p className="mt-0.5 text-muted">
                Security question: <span className="font-medium text-fg">{status?.question ?? QUESTION}</span>
              </p>
              <p className="mt-1 text-muted">
                Your answer is stored only as a one-way hash. It is not shown on this page and cannot be
                recovered by anyone, including you — that is what makes it safe. If you forget it, use the{" "}
                <code className="text-[10px] text-dim">ADMIN_INITIAL_PASSWORD</code> environment variable instead.
              </p>
            </div>
          </div>
          <details className="rounded-xl border border-border bg-bg px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium text-muted transition hover:text-fg">
              Set a different answer
            </summary>
            <p className="mt-2 mb-3 text-[10px] text-dim">
              The previous answer stops working immediately.
            </p>
            <AnswerForm
              currentPw={currentPw} setCurrentPw={setCurrentPw}
              answer={answer} setAnswer={setAnswer}
              confirm={confirm} setConfirm={setConfirm}
              show={show} setShow={setShow}
              busy={busy} onSave={save}
              submitLabel="Save new answer"
            />
            {msg && <Message msg={msg} />}
          </details>
          {msg && !configured && <Message msg={msg} />}
        </>
      ) : (
        <>
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs">
              <p className="font-semibold text-warning">No recovery answer set</p>
              <p className="mt-0.5 text-muted">
                If you forget the admin password there is currently no way back in except the
                <code className="text-[10px]"> ADMIN_INITIAL_PASSWORD </code> env var. Set an answer below.
              </p>
            </div>
          </div>
          <AnswerForm
            currentPw={currentPw} setCurrentPw={setCurrentPw}
            answer={answer} setAnswer={setAnswer}
            confirm={confirm} setConfirm={setConfirm}
            show={show} setShow={setShow}
            busy={busy} onSave={save}
            submitLabel="Save my answer"
          />
          {msg && <Message msg={msg} />}
        </>
      )}
    </div>
  );
}

function AnswerForm(props: {
  currentPw: string; setCurrentPw: (v: string) => void;
  answer: string; setAnswer: (v: string) => void;
  confirm: string; setConfirm: (v: string) => void;
  show: boolean; setShow: (v: boolean) => void;
  busy: boolean; onSave: () => void; submitLabel: string;
}) {
  const { currentPw, setCurrentPw, answer, setAnswer, confirm, setConfirm, show, setShow, busy, onSave, submitLabel } = props;
  const mismatch = confirm.length > 0 && answer.trim().toLowerCase() !== confirm.trim().toLowerCase();

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-muted">Current admin password</label>
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
            className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted">{QUESTION}</label>
          <div className="relative mt-1.5">
            <input type={show ? "text" : "password"} value={answer} onChange={(e) => setAnswer(e.target.value)}
              autoComplete="off"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 pr-10 text-sm outline-none ring-go focus:ring-2" />
            <button type="button" onClick={() => setShow(!show)}
              aria-label={show ? "Hide answer" : "Show answer"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dim transition hover:text-fg">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted">Confirm answer</label>
          <input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          {mismatch && <p className="mt-2 text-[10px] text-danger">Answers do not match</p>}
        </div>
      </div>
      <button type="button" onClick={onSave} disabled={busy || !currentPw || !answer.trim() || mismatch}
        className="mt-4 flex items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {busy ? "Saving…" : submitLabel}
      </button>
    </>
  );
}

function Message({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${msg.ok ? "border-success/25 bg-success/10 text-success" : "border-danger/25 bg-danger/10 text-danger"}`}>
      {msg.text}
    </p>
  );
}