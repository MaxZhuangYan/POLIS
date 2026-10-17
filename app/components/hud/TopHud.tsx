"use client";

import type { AgentView, ProgressionView, WorldView } from "@/lib/types";
import { TitleProgress } from "./Progress";
import { Icon, Portrait, SunMoon } from "./common";
import { fmtSpan } from "./time";
import styles from "./hud.module.css";

// ───────────────────────────── my Agent card (top-left) ─────────────────────────────
//
// One place for "who is it, how is it doing, what is it doing right now and why": identity (name, title), the three
// numbers, the current action with its progress, and the reason behind it (a principle of yours, an answer you gave).

const PROGRESS_SEGMENTS = 20;

/** where the current task / walk stands: 0..100 and the time left, or nothing when it is just idling */
function actionProgress(agent: AgentView, simNow: number): { pct: number; left: string | null } | null {
  if (agent.progress !== null) return { pct: Math.round(Math.min(1, Math.max(0, agent.progress)) * 100), left: null };
  if (agent.travel) {
    const span = Math.max(1, agent.travel.endMs - agent.travel.startMs);
    return { pct: Math.round(Math.min(1, Math.max(0, (simNow - agent.travel.startMs) / span)) * 100), left: fmtSpan(agent.travel.endMs - simNow) };
  }
  return null;
}

export function AgentCard({
  agent,
  trust,
  simNow,
  onOpenPrinciples,
  progression
}: {
  agent: AgentView;
  trust: number;
  simNow: number;
  onOpenPrinciples: () => void;
  /** title progress + fact-backed epithets (the guardian's Agent only) */
  progression?: ProgressionView;
}) {
  const prog = actionProgress(agent, simNow);
  const filled = prog ? Math.round((prog.pct / 100) * PROGRESS_SEGMENTS) : 0;
  return (
    <section className={`${styles.panel} ${styles.agentCard}`} aria-label="我的 Agent" data-coach="agent-card">
      <button type="button" className={styles.portraitBtn} onClick={onOpenPrinciples} title="看它记住了什么（R）" aria-label={`${agent.name}：看它记住了什么`}>
        <Portrait sprite={agent.sprite} size={48} player />
      </button>
      <div className={styles.agentMeta}>
        <div className={styles.nameRow}>
          <strong className={styles.agentName}>★ {agent.name}</strong>
        </div>
        <span className={styles.youTag}>你守护的 Agent{agent.role && agent.role !== "你守护的 Agent" ? ` · ${agent.role}` : ""}</span>
        {progression ? (
          <div className={styles.titleWrap}>
            <TitleProgress progression={progression} />
          </div>
        ) : null}
      </div>
      <ul className={styles.chips}>
        <li className={styles.chip} title="Scrip（城邦通用的小额货币）">
          <Icon name="scrip" size={16} />
          <span className={styles.chipVal}>{agent.scrip}</span>
          <span className={styles.chipLabel}>Scrip</span>
        </li>
        <li className={styles.chip} title="声望">
          <Icon name="reputation" size={16} />
          <span className={styles.chipVal}>{agent.reputation}</span>
          <span className={styles.chipLabel}>声望</span>
        </li>
        <li className={styles.chip} title="它对你的信任（0–200）">
          <Icon name="relations" size={16} />
          <span className={styles.chipVal}>
            {trust}
            <small>/200</small>
          </span>
          <span className={styles.chipLabel}>信任</span>
        </li>
      </ul>
      <div className={styles.doing} data-coach="activity">
        <p className={styles.activity}>
          <span className={styles.activityDot} aria-hidden />
          <span>{agent.activityText}</span>
        </p>
        {prog ? (
          <div className={styles.doingBar}>
            <div className={styles.progress} role="progressbar" aria-label="当前行动进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct}>
              {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
                <i key={i} className={i < filled ? styles.progressOn : ""} />
              ))}
            </div>
            <span className={styles.doingPct}>
              {prog.pct}%{prog.left ? ` · 还要 ${prog.left}` : ""}
            </span>
          </div>
        ) : null}
        {agent.reason ? <Reason text={agent.reason} /> : null}
      </div>
    </section>
  );
}

export function Reason({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <blockquote className={`${styles.reason} ${compact ? styles.reasonCompact : ""}`} title="它这么做的原因">
      <Icon name="diary" size={16} className={styles.reasonIcon} />
      <span>{text}</span>
    </blockquote>
  );
}

// ───────────────────────────── clock (top-centre) ─────────────────────────────

export function ClockPill({ day, clock, night, minutesToTick }: { day: number; clock: string; night: boolean; minutesToTick: number | null }) {
  return (
    <div className={`${styles.bar} ${styles.clockPill}`} aria-label="小镇时间">
      <SunMoon night={night} size={32} />
      <span className={styles.clockDay}>第 {day} 天</span>
      <span className={styles.clockTime}>{clock}</span>
      {minutesToTick !== null ? (
        <span className={styles.clockTick}>{minutesToTick <= 0 ? "即将整点" : `下个整点 ${minutesToTick} 分钟后`}</span>
      ) : null}
    </div>
  );
}

// ───────────────────────────── status pills (top-right) ─────────────────────────────

export function StatusPills({ world }: { world: WorldView }) {
  const offline = world.llm.mode === "offline";
  return (
    <div className={styles.pills}>
      {world.testMode ? <span className={`${styles.pill} ${styles.pillTest}`}>测试模式</span> : null}
      <span className={`${styles.pill} ${offline ? styles.pillMuted : styles.pillLive}`} title={world.llm.label}>
        <i aria-hidden className={styles.pillDot} />
        <span className={styles.pillLong}>{offline ? "离线模式（规则引擎）" : world.llm.label || "智能模式"}</span>
        <span className={styles.pillShort}>
          {offline ? "离线模式" : "智能模式"}
          {world.testMode ? "·测试" : ""}
        </span>
      </span>
    </div>
  );
}

export function OffsetNote({ world }: { world: WorldView }) {
  if (world.offsetMs <= 0) return null;
  const hours = Math.round((world.offsetMs / 3_600_000) * 10) / 10;
  return (
    <p className={styles.offsetNote}>
      已测试快进 {hours} 小时<span className={styles.offsetLong}>（正式玩法为现实时间 1:1）</span>
    </p>
  );
}
