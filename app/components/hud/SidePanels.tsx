"use client";

import { useMemo, type ReactNode } from "react";
import type { AgentView, FeedItem, PlayerView, RelationshipView } from "@/lib/types";
import { Btn, Icon, PrincipleTablet, Portrait } from "./common";
import { fmtClock } from "./time";
import styles from "./hud.module.css";

// ───────────────────────────── town feed ─────────────────────────────

const FEED_ICON: Record<FeedItem["kind"], string> = {
  task: "brick",
  coop: "relations",
  default: "ticket",
  refuse: "pause",
  moment: "help",
  principle: "diary",
  judgment: "reputation",
  note: "keyboard",
  postcard: "ticket",
  trust: "reputation",
  risk: "energy",
  relationship: "relations",
  system: "game"
};

export function FeedPanel({
  feed,
  open,
  onToggle,
  onPick
}: {
  feed: FeedItem[];
  open: boolean;
  onToggle: () => void;
  onPick: (item: FeedItem) => void;
}) {
  const items = useMemo(() => [...feed].sort((a, b) => b.atMs - a.atMs || b.id - a.id).slice(0, 40), [feed]);
  return (
    <section className={`${styles.panel} ${styles.feed} ${open ? "" : styles.feedClosed}`} aria-label="小镇动态">
      <button type="button" className={styles.feedHead} onClick={onToggle} aria-expanded={open}>
        <Icon name="game" size={18} />
        <span className={styles.feedTitle}>小镇动态</span>
        <span className={styles.feedCount}>{items.length}</span>
        <span className={styles.chev} aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <ol className={styles.feedList}>
          {items.length === 0 ? <li className={styles.feedEmpty}>小镇很安静。</li> : null}
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className={`${styles.feedItem} ${it.involvesPlayer ? styles.feedMine : ""} ${it.importance === 3 ? styles.feedStrong : ""}`}
                onClick={() => onPick(it)}
                title={it.actors.length ? "把镜头移过去" : undefined}
              >
                <span className={styles.feedClock}>{it.clock}</span>
                <Icon name={FEED_ICON[it.kind] ?? "game"} size={16} className={styles.feedIcon} />
                <span className={styles.feedText}>{it.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

// ───────────────────────────── right rail ─────────────────────────────

export type DrawerTab = "principles" | "relations" | "memories" | "help";

export function Rail({
  active,
  unread,
  postcardOpen,
  onDrawer,
  onPostcards
}: {
  active: DrawerTab | null;
  unread: number;
  postcardOpen: boolean;
  onDrawer: (t: DrawerTab) => void;
  onPostcards: () => void;
}) {
  const btn = (key: string, icon: string, label: string, on: boolean, click: () => void, badge?: number) => (
    <button key={key} type="button" className={`${styles.railBtn} ${on ? styles.railBtnOn : ""}`} onClick={click} aria-pressed={on} title={label}>
      <Icon name={icon} size={26} />
      <span className={styles.railLabel}>{label}</span>
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </button>
  );
  return (
    <nav className={styles.rail} aria-label="抽屉">
      {btn("principles", "thoughts", "烙印", active === "principles", () => onDrawer("principles"))}
      {btn("relations", "relations", "关系", active === "relations", () => onDrawer("relations"))}
      {btn("memories", "diary", "记忆", active === "memories", () => onDrawer("memories"))}
      {btn("postcards", "ticket", "明信片", postcardOpen, onPostcards, unread)}
      {btn("help", "help", "帮助", active === "help", () => onDrawer("help"))}
    </nav>
  );
}

// ───────────────────────────── drawer ─────────────────────────────

const TAB_LABEL: Record<DrawerTab, string> = { principles: "烙印", relations: "关系", memories: "记忆", help: "帮助" };

export function Drawer({
  tab,
  onTab,
  onClose,
  player,
  agents,
  simNowTz
}: {
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  onClose: () => void;
  player: PlayerView | null;
  agents: AgentView[];
  simNowTz: string;
}) {
  return (
    <aside className={`${styles.panel} ${styles.drawer}`} aria-label={TAB_LABEL[tab]}>
      <header className={styles.drawerHead}>
        <div className={styles.tabs} role="tablist">
          {(Object.keys(TAB_LABEL) as DrawerTab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${styles.tab} ${tab === t ? styles.tabOn : ""}`} onClick={() => onTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </header>
      <div className={styles.drawerBody}>
        {tab === "principles" ? <PrinciplesTab player={player} /> : null}
        {tab === "relations" ? <RelationsTab player={player} agents={agents} tz={simNowTz} /> : null}
        {tab === "memories" ? <MemoriesTab player={player} /> : null}
        {tab === "help" ? <HelpTab /> : null}
      </div>
    </aside>
  );
}

function PrinciplesTab({ player }: { player: PlayerView | null }) {
  const list = useMemo(() => {
    const items = [...(player?.principles ?? [])];
    items.sort((a, b) => Number(a.dormant) - Number(b.dormant) || b.weight - a.weight);
    return items;
  }, [player?.principles]);
  if (!player || list.length === 0) {
    return <p className={styles.empty}>还没有烙印。回应它的岔路，它会记住。</p>;
  }
  return (
    <div className={styles.tabletList}>
      <p className={styles.tabHint}>它做决定时会引用这些话；很久不用的会慢慢沉睡。</p>
      {list.map((p) => (
        <PrincipleTablet key={p.id} p={p} />
      ))}
    </div>
  );
}

function RelationsTab({ player, agents, tz }: { player: PlayerView | null; agents: AgentView[]; tz: string }) {
  if (!player || player.relationships.length === 0) {
    return <p className={styles.empty}>它还没和任何人熟起来。</p>;
  }
  const byId = new Map(agents.map((a) => [a.id, a]));
  const rels = [...player.relationships].sort((a, b) => b.familiarity - a.familiarity);
  return (
    <ul className={styles.relList}>
      {rels.map((r) => (
        <RelationCard key={r.otherId} rel={r} other={byId.get(r.otherId) ?? null} tz={tz} />
      ))}
    </ul>
  );
}

function RelationCard({ rel, other, tz }: { rel: RelationshipView; other: AgentView | null; tz: string }) {
  const fam = Math.max(0, Math.min(100, rel.familiarity));
  return (
    <li className={styles.relCard}>
      <div className={styles.relHead}>
        <Portrait sprite={other?.sprite ?? "rookie"} size={44} />
        <div className={styles.relWho}>
          <strong>{other?.name ?? rel.otherId}</strong>
          <span>{other?.role ?? ""}</span>
        </div>
        <span className={styles.relCoop} title="一起完成的任务">
          合作 {rel.coopDone} 次
        </span>
      </div>
      <div className={styles.famRow} title={`熟悉度 ${fam}/100`}>
        <span>熟悉度</span>
        <span className={styles.famTrack}>
          <i style={{ width: `${fam}%` }} />
        </span>
        <span className={styles.famNum}>{fam}</span>
      </div>
      {rel.lastEvent ? <p className={styles.relLast}>最近：{rel.lastEvent}</p> : null}
      {rel.incidents.length > 0 ? (
        <ul className={styles.incidents}>
          {rel.incidents.slice(0, 5).map((inc, i) => (
            <li key={`${inc.atMs}-${i}`}>
              <time>{fmtClock(inc.atMs, tz)}</time>
              <span>{inc.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MemoriesTab({ player }: { player: PlayerView | null }) {
  const list = useMemo(() => [...(player?.memories ?? [])].sort((a, b) => b.atMs - a.atMs || b.id - a.id), [player?.memories]);
  if (list.length === 0) return <p className={styles.empty}>它还没有值得记下的事。</p>;
  return (
    <ol className={styles.memList}>
      {list.map((m) => (
        <li key={m.id} className={styles.memItem}>
          <time className={styles.memClock}>{m.clock}</time>
          <span>{m.text}</span>
        </li>
      ))}
    </ol>
  );
}

function HelpTab() {
  return (
    <div className={styles.help}>
      <h3>你是守护灵</h3>
      <ul>
        <li>你没有身体，也不能指挥它。它自己安排一天。</li>
        <li>它拿不定主意时，会来问你一句——这是 <b>岔路</b>。你的回答会被它记成 <b>烙印</b>。</li>
        <li>它有自己的立场：它可能 <b>照做</b>、<b>调整</b>，或 <b>拒绝</b>。拒绝时你可以强制执行，但要付出 30 Scrip，它对你的信任也会 −10。</li>
        <li>有时它会被人说动，回来 <b>质问</b> 自己的某条原则。你可以让它重申，或让它修订。</li>
        <li>每天最多 3 条 <b>留言</b>（50 字以内）。它不会秒回，会在夜里的 <b>明信片</b> 里回应你。</li>
        <li>拖动镜头、滚轮缩放；点居民看他的近况。</li>
      </ul>
    </div>
  );
}

// ───────────────────────────── inspector ─────────────────────────────

export function Inspector({
  agent,
  isMine,
  rel,
  lines,
  following,
  onFollow,
  onClose,
  onOpenPrinciples,
  extra
}: {
  agent: AgentView;
  isMine: boolean;
  rel: RelationshipView | null;
  lines: FeedItem[];
  following: boolean;
  onFollow: () => void;
  onClose: () => void;
  onOpenPrinciples: () => void;
  extra?: ReactNode;
}) {
  const fam = rel ? Math.max(0, Math.min(100, rel.familiarity)) : 0;
  return (
    <aside className={`${styles.panel} ${styles.inspector}`} aria-label="居民档案">
      <header className={styles.insHead}>
        <Portrait sprite={agent.sprite} size={56} player={isMine} />
        <div className={styles.insWho}>
          <strong>
            {isMine ? "★ " : ""}
            {agent.name}
            <span className={styles.insRole}> · {agent.role}</span>
          </strong>
          <span className={styles.insPers}>{agent.personality}</span>
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </header>
      <p className={styles.activity}>
        <span className={styles.activityDot} aria-hidden />
        <span>{agent.activityText}</span>
      </p>
      {agent.reason ? (
        <blockquote className={styles.reason}>
          <Icon name="diary" size={16} className={styles.reasonIcon} />
          <span>{agent.reason}</span>
        </blockquote>
      ) : null}
      {!isMine && rel ? (
        <div className={styles.insRel}>
          <div className={styles.famRow} title={`和你的 Agent 的熟悉度 ${fam}/100`}>
            <span>和你的 Agent</span>
            <span className={styles.famTrack}>
              <i style={{ width: `${fam}%` }} />
            </span>
            <span className={styles.famNum}>{fam}</span>
          </div>
          {rel.incidents.length > 0 ? (
            <ul className={styles.incidents}>
              {rel.incidents.slice(0, 2).map((inc, i) => (
                <li key={`${inc.atMs}-${i}`}>
                  <span>{inc.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.relLast}>还没有往来。</p>
          )}
        </div>
      ) : null}
      {lines.length > 0 ? (
        <div className={styles.insFeed}>
          <h4>最近</h4>
          <ul>
            {lines.map((l) => (
              <li key={l.id}>
                <time>{l.clock}</time>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {extra}
      <div className={styles.insActions}>
        <Btn onClick={onFollow} variant={following ? "primary" : "default"}>
          {following ? "停止跟随" : "跟随"}
        </Btn>
        {isMine ? (
          <Btn onClick={onOpenPrinciples} variant="ghost">
            查看烙印
          </Btn>
        ) : null}
      </div>
    </aside>
  );
}
