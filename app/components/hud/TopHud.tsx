"use client";

import type { AgentView, WorldView } from "@/lib/types";
import { Icon, Portrait, SunMoon } from "./common";
import { fmtSpan } from "./time";
import styles from "./hud.module.css";

// ───────────────────────────── my Agent card (top-left) ─────────────────────────────

export function AgentCard({
  agent,
  trust,
  onOpenPrinciples
}: {
  agent: AgentView;
  trust: number;
  onOpenPrinciples: () => void;
}) {
  return (
    <section className={`${styles.panel} ${styles.agentCard}`} aria-label="我的 Agent" data-coach="agent-card">
      <button type="button" className={styles.portraitBtn} onClick={onOpenPrinciples} title="查看它的烙印">
        <Portrait sprite={agent.sprite} size={60} player />
      </button>
      <div className={styles.agentMeta}>
        <div className={styles.nameRow}>
          <span className={styles.star}>★</span>
          <strong className={styles.agentName}>{agent.name}</strong>
        </div>
        <span className={styles.youTag}>{agent.role} · 你守护的 Agent</span>
      </div>
      <ul className={styles.chips}>
        <li className={styles.chip} title="Scrip（城邦通用的小额货币）">
          <Icon name="scrip" size={18} />
          <span className={styles.chipVal}>{agent.scrip}</span>
          <span className={styles.chipLabel}>Scrip</span>
        </li>
        <li className={styles.chip} title="声望">
          <Icon name="reputation" size={18} />
          <span className={styles.chipVal}>{agent.reputation}</span>
          <span className={styles.chipLabel}>声望</span>
        </li>
        <li className={styles.chip} title="它对你的信任（0–200）">
          <Icon name="relations" size={18} />
          <span className={styles.chipVal}>
            {trust}
            <small>/200</small>
          </span>
          <span className={styles.chipLabel}>信任</span>
        </li>
      </ul>
      <p className={styles.activity} data-coach="activity">
        <span className={styles.activityDot} aria-hidden />
        <span>{agent.activityText}</span>
      </p>
      {agent.reason ? <Reason text={agent.reason} /> : null}
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
    <div className={`${styles.panel} ${styles.clockPill}`} aria-label="小镇时间">
      <SunMoon night={night} size={20} />
      <span className={styles.clockDay}>第 {day} 天</span>
      <span className={styles.clockDot}>·</span>
      <span className={styles.clockTime}>{clock}</span>
      {minutesToTick !== null ? (
        <span className={styles.clockTick}>{minutesToTick <= 0 ? "即将整点" : `下个整点 ${minutesToTick} 分钟后`}</span>
      ) : null}
    </div>
  );
}

const ACTIVITY_LABEL: Record<AgentView["activity"], string> = {
  sleeping: "休息中",
  planning: "在盘算",
  traveling: "在路上",
  working: "忙活中",
  collaborating: "和人合作",
  idle: "闲逛",
  socializing: "在交谈",
  waiting: "在等你回应"
};

/** "当前行动" progress bar for my Agent, in the spirit of AIvilization's action bar */
export function ActionBar({ agent, simNow }: { agent: AgentView; simNow: number }) {
  let progress = agent.progress;
  let left: string | null = null;
  let name = agent.taskName;
  if (agent.travel) {
    const span = Math.max(1, agent.travel.endMs - agent.travel.startMs);
    const p = Math.min(1, Math.max(0, (simNow - agent.travel.startMs) / span));
    if (progress === null) progress = p;
    left = fmtSpan(agent.travel.endMs - simNow);
    if (!name) name = "赶路";
  }
  const label = name ?? ACTIVITY_LABEL[agent.activity];
  const pct = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <section className={`${styles.panel} ${styles.actionBar}`} aria-label="当前行动" data-coach="action-bar">
      <div className={styles.actionHead}>
        <span className={styles.actionLabel}>当前行动</span>
        <strong className={styles.actionName}>{label}</strong>
        {pct !== null ? <span className={styles.actionPct}>{pct}%</span> : null}
        {left ? <span className={styles.actionLeft}>还剩 {left}</span> : null}
      </div>
      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <i className={pct === null ? styles.progressIdle : ""} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      {agent.reason ? <Reason text={agent.reason} compact /> : null}
    </section>
  );
}

// ───────────────────────────── status pills (top-right) ─────────────────────────────

export function StatusPills({ world }: { world: WorldView }) {
  const offline = world.llm.mode === "offline";
  return (
    <div className={styles.pills}>
      {world.testMode ? <span className={`${styles.pill} ${styles.pillTest}`}>🧪 测试模式</span> : null}
      <span className={`${styles.pill} ${offline ? styles.pillMuted : styles.pillLive}`} title={world.llm.label}>
        <i aria-hidden className={styles.pillDot} />
        <span className={styles.pillLong}>{offline ? "离线模式（规则引擎）" : world.llm.label || "智能模式"}</span>
        <span className={styles.pillShort}>{offline ? "离线模式" : "智能模式"}</span>
      </span>
    </div>
  );
}

export function OffsetNote({ world }: { world: WorldView }) {
  if (world.offsetMs <= 0) return null;
  const hours = Math.round((world.offsetMs / 3_600_000) * 10) / 10;
  return <p className={styles.offsetNote}>已测试快进 {hours} 小时（正式玩法为现实时间 1:1）</p>;
}
