"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AgentView, JudgmentView, MomentView, NoteView, PostcardView, PrincipleView, WaveringView } from "@/lib/types";
import { Btn, DomainTag, Icon, Portrait, PrincipleTablet, Spinner, TabletPlaceholder, useFocusTrap } from "./common";
import { fmtClock, fmtCountdown } from "./time";
import m from "./modals.module.css";

// ───────────────────────────── frame ─────────────────────────────

export function ModalFrame({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  wide = false,
  tone
}: {
  title: string;
  eyebrow?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  tone?: "gold" | "paper";
}) {
  const trap = useFocusTrap(true);
  return (
    <div
      className={m.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div ref={trap} className={`${m.modal} ${wide ? m.wide : ""} ${tone === "gold" ? m.toneGold : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className={m.head}>
          <div className={m.headText}>
            {eyebrow ? <div className={m.eyebrow}>{eyebrow}</div> : null}
            <h2 className={m.title}>{title}</h2>
          </div>
          {onClose ? (
            <button type="button" className={m.close} onClick={onClose} aria-label="关闭">
              ✕
            </button>
          ) : null}
        </header>
        <div className={m.body}>{children}</div>
        {footer ? <footer className={m.foot}>{footer}</footer> : null}
      </div>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className={m.error} role="alert">
      没成功：{error}
      <span>（稍等一下，再试一次就好）</span>
    </p>
  );
}

// ───────────────────────────── onboarding ─────────────────────────────

const LOOKS: { key: string; name: string; note: string }[] = [
  { key: "rookie", name: "新人", note: "背着小包，谨慎地打量一切" },
  { key: "courier", name: "信使", note: "脚程轻快，怀里总抱着东西" },
  { key: "guide", name: "向导", note: "手里举着旗，喜欢领路" }
];

export function OnboardingModal({ busy, error, onCreate }: { busy: boolean; error: string | null; onCreate: (input: { name: string; sprite: string }) => void }) {
  const [name, setName] = useState("");
  const [sprite, setSprite] = useState("rookie");
  const len = Array.from(name.trim()).length;
  const valid = len >= 1 && len <= 12;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !busy) onCreate({ name: name.trim(), sprite });
  };
  return (
    <ModalFrame title="POLIS" eyebrow="欢迎来到一座小小的城邦" wide tone="gold">
      <form onSubmit={submit} className={m.onboard}>
        <p className={m.premise}>
          你是 <b>守护灵</b>：没有身体，只能在它拿不定主意的时候，低语一句。
          <br />
          它会记住你，但它有自己的立场。
        </p>
        <label className={m.field}>
          <span>给它起个名字</span>
          <input
            data-autofocus=""
            className={m.input}
            value={name}
            maxLength={12}
            onChange={(e) => setName(e.target.value)}
            placeholder="1–12 个字"
            autoComplete="off"
            disabled={busy}
          />
          <small className={m.counter}>{len}/12</small>
        </label>
        <p className={m.legend} id="look-legend">
          选一个外观
        </p>
        <fieldset className={m.looks} disabled={busy} aria-labelledby="look-legend">
          {LOOKS.map((l) => (
            <label key={l.key} className={`${m.look} ${sprite === l.key ? m.lookOn : ""}`}>
              <input type="radio" name="look" value={l.key} checked={sprite === l.key} onChange={() => setSprite(l.key)} />
              <Portrait sprite={l.key} size={72} player={sprite === l.key} />
              <strong>{l.name}</strong>
              <small>{l.note}</small>
            </label>
          ))}
        </fieldset>
        <ErrorLine error={error} />
        <Btn type="submit" variant="primary" full busy={busy} disabled={!valid}>
          让它入城
        </Btn>
      </form>
    </ModalFrame>
  );
}

// ───────────────────────────── decision moment (岔路) ─────────────────────────────

const MOMENT_THEME: Record<MomentView["type"], string> = { trust: "关于信任", risk: "关于风险", integrity: "关于原则" };

export function ForkModal({
  moment,
  speaker,
  me,
  step,
  simNow,
  busy,
  error,
  queue,
  onChoose,
  onLater
}: {
  moment: MomentView;
  speaker: AgentView | null;
  me: AgentView;
  step: { index: number; total: number } | null;
  simNow: number;
  busy: boolean;
  error: string | null;
  queue?: { index: number; total: number; onPick: (i: number) => void };
  onChoose: (optionId: string) => void;
  onLater?: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setPicked(null);
  }, [busy, moment.id]);
  const left = moment.expiresAtMs - simNow;
  return (
    <ModalFrame
      title={step ? `第 ${step.index}/${step.total} 件事` : `岔路 · ${MOMENT_THEME[moment.type]}`}
      eyebrow={step ? "它第一次入城。拿不定主意时，它会低声问你。" : <DomainTag domain={moment.type} />}
      onClose={onLater}
      wide
    >
      {queue && queue.total > 1 ? (
        <div className={m.queue} role="tablist" aria-label="待回应的岔路">
          {Array.from({ length: queue.total }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === queue.index} className={`${m.queueDot} ${i === queue.index ? m.queueOn : ""}`} onClick={() => queue.onPick(i)}>
              第 {i + 1} 件
            </button>
          ))}
        </div>
      ) : null}
      <div className={m.speakers}>
        {speaker ? (
          <figure>
            <Portrait sprite={speaker.sprite} size={64} />
            <figcaption>
              {speaker.name}
              <small>{speaker.role}</small>
            </figcaption>
          </figure>
        ) : null}
        <figure>
          <Portrait sprite={me.sprite} size={64} player />
          <figcaption>
            {me.name}
            <small>你的 Agent</small>
          </figcaption>
        </figure>
      </div>
      <p className={m.prompt}>{moment.promptText}</p>
      {moment.facts.length > 0 ? (
        <section className={m.facts} aria-label="可核查的记录">
          <h3>可核查的记录</h3>
          <ul>
            {moment.facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {moment.escalation ? (
        <p className={m.escalation}>
          <Icon name="help" size={16} /> {moment.escalation}
        </p>
      ) : null}
      <div className={m.options}>
        {moment.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={m.option}
            disabled={busy}
            onClick={() => {
              setPicked(o.id);
              onChoose(o.id);
            }}
          >
            {busy && picked === o.id ? <Spinner size={16} /> : null}
            <span>{o.label}</span>
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      <p className={m.fine}>
        24 小时内不回应，它会按自己的原则决定（剩 {fmtCountdown(left)}）
        {onLater ? (
          <>
            {"　"}
            <button type="button" className={m.link} onClick={onLater}>
              稍后再说
            </button>
          </>
        ) : null}
      </p>
    </ModalFrame>
  );
}

// ───────────────────────────── imprint reveal ─────────────────────────────

export function ImprintModal({
  principles,
  distilling,
  busy,
  error,
  onAck
}: {
  principles: PrincipleView[];
  distilling: number;
  busy: boolean;
  error: string | null;
  onAck: () => void;
}) {
  const sorted = useMemo(() => [...principles].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id - b.id), [principles]);
  return (
    <ModalFrame title={`${sorted.length} 条原则已写入记忆`} eyebrow="你的三次低语，成了它的烙印" wide tone="gold">
      <div className={m.tablets}>
        {sorted.map((p, i) => (
          <PrincipleTablet key={p.id} p={p} appear delayMs={250 + i * 650} />
        ))}
        {Array.from({ length: Math.max(0, distilling) }, (_, i) => (
          <TabletPlaceholder key={`ph${i}`} n={i} />
        ))}
      </div>
      {distilling > 0 ? (
        <p className={m.fine} role="status">
          记忆形成中…
        </p>
      ) : null}
      <ErrorLine error={error} />
      <Btn variant="primary" full busy={busy} onClick={onAck} autoFocus>
        看它出发
      </Btn>
    </ModalFrame>
  );
}

// ───────────────────────────── judgment ─────────────────────────────

const DECISION: Record<JudgmentView["decision"], { label: string; cls: string; lead: string }> = {
  execute: { label: "照做", cls: "decExec", lead: "它决定照你说的办。" },
  adjust: { label: "调整", cls: "decAdjust", lead: "它想稍微改一下做法。" },
  refuse: { label: "拒绝", cls: "decRefuse", lead: "这一次，它不想那么做。" }
};

export function JudgmentModal({
  j,
  me,
  busy,
  error,
  onResolve,
  onClose
}: {
  j: JudgmentView;
  me: AgentView;
  busy: boolean;
  error: string | null;
  onResolve: (action: "accept" | "force" | "adopt" | "overrule") => void;
  onClose: () => void;
}) {
  const d = DECISION[j.decision];
  const [which, setWhich] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setWhich(null);
  }, [busy]);
  const go = (a: "accept" | "force" | "adopt" | "overrule") => {
    setWhich(a);
    onResolve(a);
  };
  const forceReason = !j.canForce ? (me.scrip < j.forceCost ? `需要 ${j.forceCost} Scrip，它现在只有 ${me.scrip}` : "这次不能强制执行") : null;
  return (
    <ModalFrame title="它的回应" eyebrow={<span className={`${m.decision} ${m[d.cls]}`}>{d.label}</span>} onClose={onClose} wide>
      <div className={m.judgeTop}>
        <Portrait sprite={me.sprite} size={64} player />
        <div>
          <p className={m.lead}>{d.lead}</p>
          <p className={m.chosen}>
            你的选择：<b>{j.chosenLabel}</b>
            {j.decision === "adjust" && j.adjustLabel ? (
              <>
                <br />
                它想改成：<b>{j.adjustLabel}</b>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <blockquote className={m.speech}>{j.toPlayer}</blockquote>
      {j.citedPrinciple ? (
        <div className={m.cite}>
          <span>它想起了自己的一条原则</span>
          <q>『{j.citedPrinciple.text}』</q>
        </div>
      ) : null}
      {j.reasons.length > 0 ? (
        <section className={m.facts}>
          <h3>依据</h3>
          <ul>
            {j.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {j.source === "rules" ? <span className={m.sourceTag}>规则判定</span> : null}
      <ErrorLine error={error} />
      <div className={m.actions}>
        {j.decision === "refuse" ? (
          <>
            <Btn variant="primary" busy={busy && which === "accept"} disabled={busy} onClick={() => go("accept")} autoFocus>
              尊重它的判断
            </Btn>
            <Btn variant="danger" busy={busy && which === "force"} disabled={busy || !j.canForce} onClick={() => go("force")} title={forceReason ?? undefined}>
              强制执行（{j.forceCost} Scrip · 信任 −10）
            </Btn>
          </>
        ) : j.decision === "adjust" ? (
          <>
            <Btn variant="primary" busy={busy && which === "adopt"} disabled={busy} onClick={() => go("adopt")} autoFocus>
              采纳它的调整
            </Btn>
            <Btn busy={busy && which === "overrule"} disabled={busy} onClick={() => go("overrule")}>
              坚持原来的选择
            </Btn>
          </>
        ) : (
          <Btn variant="primary" busy={busy && which === "accept"} disabled={busy} onClick={() => go("accept")} autoFocus>
            好，去吧
          </Btn>
        )}
      </div>
      {forceReason && j.decision === "refuse" ? <p className={m.fine}>{forceReason}</p> : null}
    </ModalFrame>
  );
}

// ───────────────────────────── wavering (质问) ─────────────────────────────

export function WaveringModal({
  w,
  me,
  challenger,
  busy,
  error,
  onResolve,
  onClose
}: {
  w: WaveringView;
  me: AgentView;
  challenger: string;
  busy: boolean;
  error: string | null;
  onResolve: (resolution: "reaffirm" | "revise", text?: string) => void;
  onClose: () => void;
}) {
  const [revising, setRevising] = useState(false);
  const [text, setText] = useState("");
  const [which, setWhich] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setWhich(null);
  }, [busy]);
  const len = Array.from(text.trim()).length;
  return (
    <ModalFrame title={`和 ${challenger} 聊过之后，它来找你`} eyebrow="质问" onClose={onClose} wide>
      <div className={m.judgeTop}>
        <Portrait sprite={me.sprite} size={64} player />
        <p className={m.lead}>它对自己的一条原则，有点动摇了。</p>
      </div>
      <div className={m.cite}>
        <span>被动摇的原则</span>
        <q>『{w.principleText}』</q>
      </div>
      <p className={m.prompt}>{w.promptText}</p>
      {revising ? (
        <label className={m.field}>
          <span>改成什么？（20 字以内）</span>
          <input
            data-autofocus=""
            className={m.input}
            value={text}
            maxLength={20}
            onChange={(e) => setText(e.target.value)}
            placeholder={w.principleText.slice(0, 20)}
            disabled={busy}
          />
          <small className={m.counter}>{len}/20</small>
        </label>
      ) : null}
      <ErrorLine error={error} />
      <div className={m.actions}>
        {!revising ? (
          <>
            <Btn
              variant="primary"
              busy={busy && which === "reaffirm"}
              disabled={busy}
              onClick={() => {
                setWhich("reaffirm");
                onResolve("reaffirm");
              }}
              autoFocus
            >
              重申：它没错
            </Btn>
            <Btn disabled={busy} onClick={() => setRevising(true)}>
              修订这条原则
            </Btn>
          </>
        ) : (
          <>
            <Btn
              variant="primary"
              busy={busy && which === "revise"}
              disabled={busy || len < 1}
              onClick={() => {
                setWhich("revise");
                onResolve("revise", text.trim());
              }}
            >
              确认修订
            </Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => setRevising(false)}>
              返回
            </Btn>
          </>
        )}
      </div>
    </ModalFrame>
  );
}

// ───────────────────────────── notes (留言) ─────────────────────────────

export function NoteModal({
  left,
  items,
  tz,
  busy,
  error,
  onSend,
  onClose
}: {
  left: number;
  items: NoteView[];
  tz: string;
  busy: boolean;
  error: string | null;
  onSend: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const len = Array.from(text).length;
  const list = useMemo(() => [...items].sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id), [items]);
  const can = left > 0 && text.trim().length > 0 && len <= 50;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!can || busy) return;
    const ok = await onSend(text.trim());
    if (ok) setText("");
  };
  return (
    <ModalFrame title="留言" eyebrow={`今日剩余 ${left}/3`} onClose={onClose} wide>
      <form onSubmit={submit} className={m.noteForm}>
        <label className={m.field}>
          <span>对它说一句话（50 字以内）</span>
          <textarea
            data-autofocus=""
            className={m.textarea}
            value={text}
            maxLength={50}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            placeholder={left > 0 ? "比如：别为了赶工，把答应过的事丢了。" : "今天的留言用完了，明天再来。"}
            disabled={busy || left <= 0}
          />
          <small className={m.counter}>{len}/50</small>
        </label>
        <p className={m.hint}>它不会秒回。它会在自己的时间——下一张明信片里——回应你。</p>
        <ErrorLine error={error} />
        <Btn type="submit" variant="primary" full busy={busy} disabled={!can}>
          留下这句话
        </Btn>
      </form>
      <section className={m.noteList} aria-label="之前的留言">
        <h3>之前的留言</h3>
        {list.length === 0 ? <p className={m.emptyNote}>还没有留言。</p> : null}
        <ul>
          {list.map((n) => (
            <li key={n.id} className={m.noteItem}>
              <div className={m.noteTop}>
                <time>{fmtClock(n.createdAtMs, tz)}</time>
                <span className={`${m.noteStatus} ${n.status === "answered" ? m.noteDone : ""}`}>{n.status === "answered" ? "已回应" : "待回应"}</span>
              </div>
              <p>{n.text}</p>
              {n.reply ? <p className={m.noteReply}>它：{n.reply}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </ModalFrame>
  );
}

// ───────────────────────────── postcards ─────────────────────────────

/** wraps 『…』 / 「…」 / “…” passages and exact principle texts in marks */
function renderLine(line: string, cited: string[]): ReactNode {
  const clean = cited.map((c) => c.trim()).filter(Boolean);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quote = "『[^』]+』|「[^」]+」|“[^”]+”|\"[^\"]+\"";
  const rx = new RegExp(clean.length ? `${quote}|${clean.map(esc).join("|")}` : quote, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const match of line.matchAll(rx)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push(<Fragment key={k++}>{line.slice(last, idx)}</Fragment>);
    const seg = match[0];
    const inner = seg.replace(/^[『「“"]|[』」”"]$/g, "");
    const strong = clean.some((c) => c === inner || c.includes(inner) || inner.includes(c));
    out.push(
      <mark key={k++} className={strong ? m.markStrong : m.markSoft}>
        {seg}
      </mark>
    );
    last = idx + seg.length;
  }
  if (last < line.length) out.push(<Fragment key={k++}>{line.slice(last)}</Fragment>);
  return out;
}

export function PostcardModal({
  items,
  busy,
  error,
  initialId,
  onRead,
  onClose
}: {
  items: PostcardView[];
  busy: boolean;
  error: string | null;
  initialId: number | null;
  onRead: (id: number) => void;
  onClose: () => void;
}) {
  const list = useMemo(() => [...items].sort((a, b) => b.dayIndex - a.dayIndex || b.id - a.id), [items]);
  const [sel, setSel] = useState<number | null>(initialId ?? list.find((p) => !p.read)?.id ?? list[0]?.id ?? null);
  const asked = useRef(new Set<number>());
  const card = list.find((p) => p.id === sel) ?? list[0] ?? null;
  useEffect(() => {
    if (card && !card.read && !asked.current.has(card.id)) {
      asked.current.add(card.id);
      onRead(card.id);
    }
  }, [card, onRead]);
  const volume = card ? Math.max(1, Math.round((card.dayIndex + 1) / 7)) : 1;
  return (
    <ModalFrame title="明信片" eyebrow="它在夜里写给你的" onClose={onClose} wide tone="paper">
      {list.length === 0 || !card ? (
        <p className={m.emptyNote}>还没有明信片。今晚它会写第一张。</p>
      ) : (
        <>
          <div className={m.stamps} role="tablist" aria-label="明信片">
            {list.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={p.id === card.id} className={`${m.stampBtn} ${p.id === card.id ? m.stampOn : ""}`} onClick={() => setSel(p.id)}>
                {p.kind === "recap7" ? "档案" : `第 ${p.dayIndex + 1} 天`}
                {!p.read ? <i className={m.unreadDot} aria-label="未读" /> : null}
              </button>
            ))}
          </div>
          <article className={`${m.paper} ${card.kind === "recap7" ? m.paperRecap : ""}`}>
            <div className={m.postmark} aria-hidden>
              <span>POLIS</span>
              <b>第 {card.dayIndex + 1} 天</b>
            </div>
            <header className={m.paperHead}>
              {card.kind === "recap7" ? <div className={m.volume}>档案第 {volume} 卷</div> : <div className={m.dayTag}>第 {card.dayIndex + 1} 天</div>}
              <h3>{card.title}</h3>
            </header>
            <div className={m.paperBody}>
              {card.lines.map((line, i) => (
                <p key={i}>{renderLine(line, card.citedPrinciples)}</p>
              ))}
            </div>
            <footer className={m.paperFoot}>
              {card.source === "template" ? <span>由规则整理</span> : <span />}
              <span className={m.signature}>— 你的 Agent</span>
            </footer>
          </article>
        </>
      )}
      {busy ? (
        <p className={m.fine} role="status">
          <Spinner size={14} /> 翻开中…
        </p>
      ) : null}
      <ErrorLine error={error} />
    </ModalFrame>
  );
}
