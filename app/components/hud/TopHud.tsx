"use client";

import type { AgentView, ProgressionView, WorldView } from "@/lib/types";
import { TitleProgress } from "./Progress";
import { Icon, Portrait, SunMoon } from "./common";
import { fmtSpan } from "./time";
import styles from "./hud.module.css";

// ───────────────────────────── my Agent card (top-left) ─────────────────────────────

export function AgentCard({
  agent,
  trust,
  onOpenPrinciples,
  progression,
  compact = false
}: {
  agent: AgentView;
  trust: number;
  onOpenPrinciples: () => void;
  /** title progress + fact-backed epithets (the guardian's Agent only) */
  progression?: ProgressionView;
  compact?: boolean;
}) {
  return (
    <section className={`${styles.panel} ${styles.agentCard}`} aria-label="我的 Agent" data-coach="agent-card">
      <button type="button" className={styles.portraitBtn} onClick={onOpenPrinciples} title="查看它的烙印（R）">
        <Portrait sprite={agent.sprite} size={48} player />
      </button>
      <div className={styles.agentMeta}>
        <div className={styles.nameRow}>
          <strong className={styles.agentName}>★ {agent.name}</strong>
        </div>
        <span className={styles.youTag}>你守护的 Agent{agent.role && agent.role !== "你守护的 Agent" ? ` · ${agent.role}` : ""}</span>
        {progression ? <TitleProgress progression={progression} compact={compact} /> : null}
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

/** "还剩 2 小时" / "还需 30 分钟" in the server's own activity text -> "2 小时" */
function parseRemaining(text: string): string | null {
  const m = /(?:还剩|还需|剩余|大约还要)\s*(\d+(?:\.\d+)?)\s*(个?小时|分钟|分|天)/.exec(text);
  if (!m) return null;
  const unit = m[2].replace("个", "");
  return `${m[1]} ${unit === "分" ? "分钟" : unit}`;
}

const PROGRESS_SEGMENTS = 20;

/** "当前行动" progress bar for my Agent, in the spirit of AIvilization's action bar.
 *  A task (progress !== null) shows its own percentage and the remaining time the server wrote into
 *  activityText; with no task the bar is hidden, except while walking, where it shows the trip. */
export function ActionBar({ agent, simNow }: { agent: AgentView; simNow: number }) {
  let pct: number | null = null;
  let left: string | null = null;
  let name = agent.taskName;
  if (agent.progress !== null) {
    pct = Math.round(Math.min(1, Math.max(0, agent.progress)) * 100);
    left = parseRemaining(agent.activityText);
  } else if (agent.travel) {
    const span = Math.max(1, agent.travel.endMs - agent.travel.startMs);
    pct = Math.round(Math.min(1, Math.max(0, (simNow - agent.travel.startMs) / span)) * 100);
    left = fmtSpan(agent.travel.endMs - simNow);
    if (!name) name = "赶路";
  }
  const label = name ?? ACTIVITY_LABEL[agent.activity];
  const filled = pct === null ? 0 : Math.round((pct / 100) * PROGRESS_SEGMENTS);
  return (
    <section className={`${styles.bar} ${styles.actionBar}`} aria-label="当前行动" data-coach="action-bar">
      <div className={styles.actionHead}>
        <span className={styles.actionLabel}>当前行动</span>
        <strong className={styles.actionName}>{label}</strong>
        {pct !== null ? <span className={styles.actionPct}>{pct}%</span> : null}
        {left ? <span className={styles.actionLeft}>还剩 {left}</span> : null}
      </div>
      {pct !== null ? (
        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
            <i key={i} className={i < filled ? styles.progressOn : ""} />
          ))}
        </div>
      ) : null}
      {agent.reason ? <Reason text={agent.reason} compact /> : null}
    </section>
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
