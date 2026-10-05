"use client";

// The guardian's long game on screen: imprint slots (记忆槽位), the Agent's title and epithets, the notice board
// (公告栏), the daily ledger (日结 — never inside a postcard), the weekly three-word survey, the 默契 guess card, and the
// title-menu screens (设置 / 制作名单 / 新的存档). Data comes straight from the snapshot (lib/types.ts); every action
// goes through GameActions.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AgentView, BoardView, GuessView, LedgerDayView, PlayerView, PrincipleView, ProgressionView } from "@/lib/types";
import { Btn, Portrait, PrincipleTablet } from "./common";
import { ErrorLine, ModalFrame } from "./Modals";
import { fmtClock, fmtSpan } from "./time";
import p from "./progress.module.css";

// ───────────────────────────── title & epithets (Agent card) ─────────────────────────────

export function TitleProgress({ progression, compact = false }: { progression: ProgressionView; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (compact) return null; // phones: the title is already in the card's subtitle; epithets live in the 烙印 drawer
  const pct = progression.nextAt ? Math.max(0, Math.min(100, Math.round((progression.reputation / progression.nextAt) * 100))) : 100;
  return (
    <div className={p.titleRow}>
      {progression.nextTitle && !compact ? (
        <span className={p.nextTitle} title={`声望 ${progression.reputation} / ${progression.nextAt} → ${progression.nextTitle}`}>
          <span className={p.repTrack}>
            <i style={{ width: `${pct}%` }} />
          </span>
          声望 {progression.reputation}/{progression.nextAt} → {progression.nextTitle}
        </span>
      ) : null}
      {progression.epithets.length > 0 ? (
        <span className={p.epithets}>
          {progression.epithets.map((e) => (
            <button
              key={e.label}
              type="button"
              className={`${p.epithet} ${open === e.label ? p.epithetOn : ""}`}
              title={e.why}
              onClick={() => setOpen((cur) => (cur === e.label ? null : e.label))}
            >
              {e.label}
            </button>
          ))}
          {open ? <span className={p.epithetWhy}>{progression.epithets.find((e) => e.label === open)?.why}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

// ───────────────────────────── imprints: slots, dormant, wake ─────────────────────────────

export function PrinciplesPanel({
  player,
  busy,
  error,
  onWake,
  onBuySlot
}: {
  player: PlayerView;
  busy: boolean;
  error: string | null;
  onWake: (id: number, sleepId: number | null) => void;
  onBuySlot: () => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const shaped = (x: PrincipleView) => x.source === "llm" || x.source === "fallback" || x.source === "note" || x.source === "revised";
  const active = useMemo(() => player.principles.filter((x) => !x.dormant).sort((a, b) => b.weight - a.weight), [player.principles]);
  const dormant = useMemo(() => player.principles.filter((x) => x.dormant && shaped(x)), [player.principles]);
  const slots = player.imprintSlots;
  const full = slots.used >= slots.total;
  const cost = slots.nextCost;
  const scrip = player.agent.scrip;
  const a = player.attunement;
  useEffect(() => {
    if (!busy) setConfirmBuy(false);
  }, [busy, slots.total]);

  if (player.principles.length === 0) return <p className={p.empty}>还没有烙印。回应它的岔路，它会记住。</p>;
  return (
    <div className={p.panel}>
      <div className={p.slotHead}>
        <span className={p.slotLabel}>记忆</span>
        <span className={p.slots} aria-label={`记忆 ${slots.used}/${slots.total}`}>
          {Array.from({ length: slots.total }, (_, i) => (
            <i key={i} className={i < slots.used ? p.slotOn : ""} />
          ))}
        </span>
        <b>
          {slots.used}/{slots.total}
        </b>
        {a.total > 0 ? (
          <span className={p.attune} title="你猜中它自己拿主意的次数">
            默契 {a.correct}/{a.total}
          </span>
        ) : null}
      </div>
      <p className={p.hint}>它只记得住 {slots.total} 条。新的烙印进来时，最久没用上的那条会慢慢沉睡；你可以把它唤醒。</p>
      {cost !== null ? (
        confirmBuy ? (
          <div className={p.confirm}>
            <span>
              花 {cost} Scrip 让它多记一条（现在 {slots.total} 条）？这笔钱会被销毁。
            </span>
            <span className={p.btnRow}>
              <Btn size="sm" variant="primary" busy={busy} disabled={scrip < cost} onClick={onBuySlot}>
                确定
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setConfirmBuy(false)}>
                再想想
              </Btn>
            </span>
          </div>
        ) : (
          <Btn size="sm" disabled={scrip < cost} title={scrip < cost ? `需要 ${cost} Scrip，它现在有 ${scrip}` : undefined} onClick={() => setConfirmBuy(true)}>
            扩展记忆 +1 格（{cost} Scrip）
          </Btn>
        )
      ) : null}
      <ErrorLine error={error} />
      <div className={p.tablets}>
        {active.map((x) => (
          <PrincipleTablet key={x.id} p={x} />
        ))}
      </div>
      {dormant.length > 0 ? (
        <section className={p.dormantSec}>
          <h3>沉睡的烙印</h3>
          {dormant.map((x) => (
            <div key={x.id} className={p.dormantItem}>
              <PrincipleTablet p={x} />
              {picking === x.id ? (
                <div className={p.picker} role="group" aria-label="让哪一条先沉睡">
                  <span>记忆满了。让哪一条先沉睡？</span>
                  {active
                    .filter(shaped)
                    .map((o) => (
                      <Btn key={o.id} size="sm" busy={busy} onClick={() => onWake(x.id, o.id)}>
                        『{o.text}』
                      </Btn>
                    ))}
                  <Btn size="sm" variant="ghost" onClick={() => setPicking(null)}>
                    算了
                  </Btn>
                </div>
              ) : (
                <Btn size="sm" busy={busy} onClick={() => (full ? setPicking(x.id) : onWake(x.id, null))}>
                  唤醒
                </Btn>
              )}
            </div>
          ))}
        </section>
      ) : null}
      {player.survey.history.length > 0 ? (
        <p className={p.surveyPast}>
          {player.survey.history
            .slice(-2)
            .map((s) => `第 ${s.volume} 卷，你说它：${s.words.join("、")}`)
            .join("　")}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────── 公告栏 ─────────────────────────────

export function BoardModal({ board, meId, tz, onClose }: { board: BoardView; meId: string | null; tz: string; onClose: () => void }) {
  return (
    <ModalFrame title="公告栏" eyebrow={`城邦第 ${board.week} 周 · 本周履约榜`} onClose={onClose} wide tone="paper">
      <table className={p.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>名字</th>
            <th>称号</th>
            <th>本周完成</th>
            <th>声望</th>
            <th>违约</th>
          </tr>
        </thead>
        <tbody>
          {board.ranks.map((r, i) => (
            <tr key={r.id} className={r.id === meId ? p.me : ""}>
              <td>{i + 1}</td>
              <td>
                {r.id === meId ? "★ " : ""}
                {r.name}
              </td>
              <td>{r.title}</td>
              <td>{r.weekDone}</td>
              <td>{r.reputation}</td>
              <td>{r.defaults}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className={p.notices}>
        <h3>本周的事</h3>
        {board.notices.length === 0 ? (
          <p className={p.empty}>这一周还没有值得贴出来的事。</p>
        ) : (
          <ul>
            {board.notices.map((n, i) => (
              <li key={`${n.atMs}-${i}`}>
                <time>{fmtClock(n.atMs, tz)}</time>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ModalFrame>
  );
}

// ───────────────────────────── 账本（日结） ─────────────────────────────

const GROUPS: Array<{ kind: LedgerDayView["lines"][number]["kind"]; label: string }> = [
  { kind: "income", label: "进账" },
  { kind: "loss", label: "赔损" },
  { kind: "spent", label: "花销" },
  { kind: "transfer", label: "往来" },
  { kind: "burn", label: "销毁" }
];

export function LedgerModal({ ledger, today, onClose }: { ledger: LedgerDayView[]; today: number; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  const day = ledger[sel];
  const tabLabel = (d: LedgerDayView) => (d.dayIndex === today ? "今天" : d.dayIndex === today - 1 ? "昨天" : `第 ${d.dayIndex + 1} 天`);
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    <ModalFrame title="账本" eyebrow="日结 · 它这几天的进出" onClose={onClose} wide>
      {ledger.length === 0 || !day ? (
        <p className={p.empty}>还没有账。</p>
      ) : (
        <>
          <div className={p.dayTabs} role="tablist">
            {ledger.map((d, i) => (
              <button key={d.startMs} type="button" role="tab" aria-selected={i === sel} className={`${p.dayTab} ${i === sel ? p.dayTabOn : ""}`} onClick={() => setSel(i)}>
                {tabLabel(d)}
              </button>
            ))}
          </div>
          <div className={p.ledgerTop}>
            <div>
              <span>净变化</span>
              <b className={day.net >= 0 ? p.pos : p.neg}>{sign(day.net)} Scrip</b>
            </div>
            <div>
              <span>声望</span>
              <b>{sign(day.reputationDelta)}</b>
            </div>
            <div>
              <span>信任</span>
              <b>{sign(day.trustDelta)}</b>
            </div>
            <div>
              <span>做完 / 失败</span>
              <b>
                {day.tasksDone} / {day.tasksFailed}
              </b>
            </div>
          </div>
          {day.lines.length === 0 ? <p className={p.empty}>这一天没有进出。</p> : null}
          {GROUPS.map((g) => {
            const lines = day.lines.filter((l) => l.kind === g.kind);
            if (lines.length === 0) return null;
            return (
              <section key={g.kind} className={p.ledgerGroup}>
                <h3>{g.label}</h3>
                <ul>
                  {lines.map((l) => (
                    <li key={l.reason}>
                      <span>
                        {l.label}
                        {l.count > 1 ? ` ×${l.count}` : ""}
                      </span>
                      <b className={l.amount >= 0 ? p.pos : p.neg}>{sign(l.amount)}</b>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <section className={p.ledgerGroup}>
            <h3>烙印</h3>
            <p className={p.ledgerNote}>
              {day.imprints.length ? `新的烙印：${day.imprints.map((t) => `『${t}』`).join("、")}。` : "这一天没有新的烙印。"}
              它的烙印被引用了 {day.citations} 次。
            </p>
          </section>
          <p className={p.hint}>销毁 = 任务报酬的 5% 手续费、记忆槽位和指令券的花费，从城里永久消失。</p>
        </>
      )}
    </ModalFrame>
  );
}

// ───────────────────────────── 三词问卷 ─────────────────────────────

export function SurveyCard({ volume, name, busy, error, onSubmit, onLater }: { volume: number; name: string; busy: boolean; error: string | null; onSubmit: (words: string[]) => void; onLater: () => void }) {
  const [words, setWords] = useState(["", "", ""]);
  const ready = words.every((w) => w.trim().length > 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSubmit(words.map((w) => w.trim()));
  };
  return (
    <form className={p.card} onSubmit={submit} aria-label="三词问卷">
      <p className={p.cardTitle}>档案第 {volume} 卷读完了。用三个词形容 {name}：</p>
      <div className={p.words}>
        {words.map((w, i) => (
          <input
            key={i}
            className={p.word}
            value={w}
            maxLength={8}
            placeholder={["比如：倔", "比如：念旧", "比如：心软"][i]}
            onChange={(e) => setWords((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
            aria-label={`第 ${i + 1} 个词`}
          />
        ))}
      </div>
      <ErrorLine error={error} />
      <div className={p.btnRow}>
        <Btn type="submit" size="sm" variant="primary" busy={busy} disabled={!ready}>
          记下来
        </Btn>
        <Btn size="sm" variant="ghost" onClick={onLater}>
          下次再说
        </Btn>
      </div>
      <p className={p.hint}>下一卷档案会引用你的这三个词。</p>
    </form>
  );
}

// ───────────────────────────── 默契 ─────────────────────────────

export function GuessCard({
  guess,
  speaker,
  me,
  simNow,
  busy,
  onGuess,
  onCollapse
}: {
  guess: GuessView;
  speaker: AgentView | null;
  me: AgentView;
  simNow: number;
  busy: boolean;
  onGuess: (optionId: string) => void;
  onCollapse: () => void;
}) {
  const left = guess.dueMs > simNow ? fmtSpan(guess.dueMs - simNow) : "";
  const guessed = guess.options.find((o) => o.id === guess.guessed);
  return (
    <section className={`${p.card} ${p.guess}`} aria-label="默契：猜它会怎么做">
      <header className={p.guessHead}>
        {speaker ? <Portrait sprite={speaker.sprite} size={32} /> : null}
        <p className={p.cardTitle}>
          {speaker?.name ?? guess.npc} 来找 {me.name} 商量：{guess.origin}。它说心里有数——
          {guessed ? "" : "你猜它会怎么做？"}
        </p>
        <button type="button" className={p.collapse} onClick={onCollapse} aria-label="收起">
          ▾
        </button>
      </header>
      {guessed ? (
        <p className={p.guessed}>
          你猜它会「{guessed.label}」。{left ? `${left}后揭晓。` : "马上揭晓。"}
        </p>
      ) : (
        <div className={p.btnRow}>
          {guess.options.map((o) => (
            <Btn key={o.id} size="sm" busy={busy} onClick={() => onGuess(o.id)}>
              {o.label}
            </Btn>
          ))}
        </div>
      )}
      <p className={p.hint}>
        {guessed ? "猜中会记进「默契」。" : `它会在 ${left || "稍后"} 内按自己的烙印拿主意；不猜也没关系。`}
      </p>
    </section>
  );
}

export function GuessPill({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={p.guessPill} onClick={onOpen}>
      它心里有数了——猜一猜？
    </button>
  );
}

// ───────────────────────────── title menu screens ─────────────────────────────

export function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame title="制作名单" onClose={onClose}>
      <div className={p.credits}>
        <h3>Polis</h3>
        <p>一个关于守护灵、记忆和骨气的单人 AI 社会模拟原型。</p>
        <h3>美术与音乐</h3>
        <p>Ninja Adventure Asset Pack — Pixel-boy &amp; AAA，CC0 1.0（公有领域）。图集经过挤压处理以避免缩放接缝。</p>
        <h3>字体</h3>
        <p>Fusion Pixel 12px（缝合像素字体）— TakWolf，SIL Open Font License 1.1。</p>
        <h3>技术</h3>
        <p>Next.js · React · Phaser 3 · SQLite（better-sqlite3） · Tiled 地图格式。</p>
        <p className={p.hint}>完整授权说明：public/assets/town/CREDITS.md、public/assets/audio/CREDITS.md、public/assets/ui/CREDITS.md。</p>
      </div>
    </ModalFrame>
  );
}

export function NewSaveModal({ hasSave, busy, error, onConfirm, onClose }: { hasSave: boolean; busy: boolean; error: string | null; onConfirm: () => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  return (
    <ModalFrame title="新的存档" onClose={busy ? undefined : onClose}>
      {!hasSave ? (
        <p className={p.hint}>现在还没有存档。直接点「开始」就好。</p>
      ) : step === 0 ? (
        <>
          <p className={p.lead}>重新开始，会让城邦回到第一天：你的 Agent、它的烙印、明信片和城里的一切都会清空。</p>
          <p className={p.hint}>旧存档会自动备份一份（同目录下的 .bak 文件，只保留最近一份）。</p>
          <div className={p.btnRow}>
            <Btn variant="danger" onClick={() => setStep(1)}>
              我要重新开始
            </Btn>
            <Btn variant="ghost" onClick={onClose}>
              算了
            </Btn>
          </div>
        </>
      ) : (
        <>
          <p className={p.lead}>最后确认一次：它会忘记你。</p>
          <ErrorLine error={error} />
          <div className={p.btnRow}>
            <Btn variant="danger" busy={busy} onClick={onConfirm}>
              确定，重新开始
            </Btn>
            <Btn variant="ghost" disabled={busy} onClick={onClose}>
              还是算了
            </Btn>
          </div>
        </>
      )}
    </ModalFrame>
  );
}

export function SettingsModal({
  music,
  sfx,
  musicVol,
  sfxVol,
  reduceMotion,
  onAudio,
  onReduceMotion,
  onNewSave,
  onClose
}: {
  music: boolean;
  sfx: boolean;
  musicVol: number;
  sfxVol: number;
  reduceMotion: boolean;
  onAudio: (patch: { music?: boolean; sfx?: boolean; musicVol?: number; sfxVol?: number }) => void;
  onReduceMotion: (v: boolean) => void;
  onNewSave?: () => void;
  onClose: () => void;
}) {
  return (
    <ModalFrame title="设置" onClose={onClose}>
      <div className={p.settings}>
        <label className={p.setRow}>
          <input type="checkbox" checked={music} onChange={(e) => onAudio({ music: e.target.checked })} />
          <span>音乐</span>
          <input type="range" min={0} max={1} step={0.05} value={musicVol} disabled={!music} onChange={(e) => onAudio({ musicVol: Number(e.target.value) })} aria-label="音乐音量" />
        </label>
        <label className={p.setRow}>
          <input type="checkbox" checked={sfx} onChange={(e) => onAudio({ sfx: e.target.checked })} />
          <span>音效</span>
          <input type="range" min={0} max={1} step={0.05} value={sfxVol} disabled={!sfx} onChange={(e) => onAudio({ sfxVol: Number(e.target.value) })} aria-label="音效音量" />
        </label>
        <label className={p.setRow}>
          <input type="checkbox" checked={reduceMotion} onChange={(e) => onReduceMotion(e.target.checked)} />
          <span>减少动态效果</span>
          <small>关闭弹出、闪烁等动画</small>
        </label>
        {onNewSave ? (
          <div className={p.setDanger}>
            <Btn size="sm" variant="danger" onClick={onNewSave}>
              新的存档…
            </Btn>
          </div>
        ) : null}
        <p className={p.hint}>设置保存在这台设备的浏览器里。</p>
      </div>
    </ModalFrame>
  );
}

export const REDUCE_MOTION_KEY = "polis.reduceMotion";
export const GUESS_SEEN_KEY = "polis.guessSeen";

