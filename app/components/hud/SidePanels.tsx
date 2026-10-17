"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentView, FeedItem, LocationId, MemoryTag, PlayerView, RelationshipView } from "@/lib/types";
import { Btn, CloseGlyph, GLYPH_DOWN, GLYPH_RIGHT, Icon, PixelGlyph, PrincipleTablet, Portrait, usePanelFocus } from "./common";
import type { TownSocial } from "./social";
import { PrinciplesPanel } from "./Progress";
import { fmtClock } from "./time";
import styles from "./hud.module.css";

// ───────────────────────────── linked text: event ↔ person ↔ place ─────────────────────────────

export interface LinkCtx {
  agents: { id: string; name: string }[];
  places: { id: LocationId; label: string }[];
  onAgent: (id: string) => void;
  onPlace: (id: LocationId) => void;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A real sentence from the town, with every resident's name and every place's name in it turned into a way to jump there. */
export function LinkedText({ text, ctx }: { text: string; ctx: LinkCtx }) {
  const parts = useMemo(() => {
    const terms: { word: string; kind: "agent" | "place"; id: string }[] = [];
    for (const a of ctx.agents) if (Array.from(a.name).length >= 2) terms.push({ word: a.name, kind: "agent", id: a.id });
    for (const p of ctx.places) if (p.label) terms.push({ word: p.label, kind: "place", id: p.id });
    if (terms.length === 0) return [text] as (string | { word: string; kind: "agent" | "place"; id: string })[];
    terms.sort((a, b) => b.word.length - a.word.length);
    const rx = new RegExp(`(${terms.map((t) => escapeRe(t.word)).join("|")})`, "g");
    return text.split(rx).map((seg) => terms.find((t) => t.word === seg) ?? seg);
  }, [text, ctx.agents, ctx.places]);
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <button
            key={i}
            type="button"
            className={`${styles.textLink} ${p.kind === "place" ? styles.textLinkPlace : ""}`}
            onClick={() => (p.kind === "agent" ? ctx.onAgent(p.id) : ctx.onPlace(p.id as LocationId))}
            title={p.kind === "agent" ? `看看 ${p.word}` : `去 ${p.word} 看看`}
          >
            {p.word}
          </button>
        )
      )}
    </>
  );
}

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

/** the things worth reading: anything that involves the player, anything the town marked important, every postcard */
export function isKeyFeedItem(it: FeedItem): boolean {
  return it.involvesPlayer || it.importance >= 2 || it.kind === "postcard";
}

type FeedRow = { type: "item"; item: FeedItem } | { type: "group"; key: number; items: FeedItem[] };

export function FeedPanel({
  feed,
  open,
  onToggle,
  all,
  onAll,
  onPick,
  activeId,
  nameOf
}: {
  feed: FeedItem[];
  open: boolean;
  onToggle: () => void;
  /** show every line (true) or the headlines with the routine jobs folded away (false) */
  all: boolean;
  onAll: (v: boolean) => void;
  onPick: (item: FeedItem) => void;
  /** the line whose people / place the town camera is on right now */
  activeId: number | null;
  nameOf: (id: string) => string | null;
}) {
  const items = useMemo(() => [...feed].sort((a, b) => b.atMs - a.atMs || b.id - a.id).slice(0, 40), [feed]);
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const rows = useMemo(() => {
    const out: FeedRow[] = [];
    for (const it of items) {
      if (all || isKeyFeedItem(it)) out.push({ type: "item", item: it });
      else {
        const last = out[out.length - 1];
        if (last && last.type === "group") last.items.push(it);
        else out.push({ type: "group", key: it.id, items: [it] });
      }
    }
    return out;
  }, [items, all]);
  const routine = useMemo(() => items.filter((i) => !isKeyFeedItem(i)).length, [items]);

  // a little "new" count while the panel is folded: headlines that arrived since it was last open
  const maxId = useMemo(() => items.reduce((n, i) => Math.max(n, i.id), 0), [items]);
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    if (seen === null || open) setSeen(maxId);
  }, [open, maxId, seen]);
  const fresh = !open && seen !== null ? items.filter((i) => i.id > seen && isKeyFeedItem(i)).length : 0;

  const renderItem = (it: FeedItem) => {
    const clickable = it.actors.length > 0 || it.kind === "postcard";
    const cls = `${styles.feedItem} ${it.involvesPlayer ? styles.feedMine : ""} ${it.importance === 3 ? styles.feedStrong : ""} ${activeId === it.id ? styles.feedActive : ""}`;
    const inner = (
      <>
        <span className={styles.feedClock}>{it.clock}</span>
        <Icon name={FEED_ICON[it.kind] ?? "game"} size={16} className={styles.feedIcon} />
        <span className={styles.feedText}>{it.text}</span>
      </>
    );
    return clickable ? (
      <button type="button" className={cls} onClick={() => onPick(it)} title={it.kind === "postcard" ? "打开明信片" : "看看这件事里的人"} aria-current={activeId === it.id ? "true" : undefined}>
        {inner}
      </button>
    ) : (
      <div className={cls}>{inner}</div>
    );
  };

  return (
    <section className={`${styles.panel} ${styles.feed} ${open ? "" : styles.feedClosed}`} aria-label="小镇动态">
      <div className={styles.feedHeadRow}>
        <button type="button" className={styles.feedHead} onClick={onToggle} aria-expanded={open} title="展开 / 收起（F）">
          <Icon name="game" size={16} />
          <span className={styles.feedTitle}>小镇动态</span>
          {fresh > 0 ? <span className={styles.feedFresh}>新 {fresh}</span> : <span className={styles.feedCount}>{items.length}</span>}
          <span className={styles.chev} aria-hidden>
            <PixelGlyph rows={open ? GLYPH_DOWN : GLYPH_RIGHT} scale={2} />
          </span>
        </button>
        {open && routine > 0 ? (
          <button type="button" className={styles.feedMode} onClick={() => onAll(!all)} aria-pressed={all} title={all ? "只看要闻，日常的活折叠起来" : "连日常的活也展开"}>
            {all ? "只看要闻" : "看全部"}
          </button>
        ) : null}
      </div>
      {open ? (
        <ol className={styles.feedList}>
          {items.length === 0 ? <li className={styles.feedEmpty}>小镇很安静。</li> : null}
          {rows.map((row) =>
            row.type === "item" ? (
              <li key={row.item.id}>{renderItem(row.item)}</li>
            ) : openGroups.has(row.key) ? (
              <li key={`g${row.key}`}>
                <ol className={styles.feedGroupOpen}>
                  {row.items.map((it) => (
                    <li key={it.id}>{renderItem(it)}</li>
                  ))}
                </ol>
                <button
                  type="button"
                  className={styles.feedGroup}
                  onClick={() =>
                    setOpenGroups((cur) => {
                      const n = new Set(cur);
                      n.delete(row.key);
                      return n;
                    })
                  }
                >
                  收起这 {row.items.length} 条
                </button>
              </li>
            ) : (
              <li key={`g${row.key}`}>
                <button
                  type="button"
                  className={styles.feedGroup}
                  onClick={() => setOpenGroups((cur) => new Set(cur).add(row.key))}
                  title="展开这几条日常"
                >
                  <span className={styles.feedGroupDot} aria-hidden />
                  <span>
                    另有 {row.items.length} 条日常
                    {(() => {
                      const names = Array.from(new Set(row.items.flatMap((i) => i.actors).map((id) => nameOf(id)).filter((n): n is string => !!n)));
                      return names.length > 0 ? `：${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}` : "";
                    })()}
                  </span>
                </button>
              </li>
            )
          )}
        </ol>
      ) : null}
    </section>
  );
}

// ───────────────────────────── right rail (desktop) ─────────────────────────────
//
// Where things live (one home each):
//   bottom dock   the guardian's verbs: 岔路 · 留言 · 明信片 · 烙印        (phone: + 更多)
//   this rail     things to look up: 关系 · 记忆 · 公告栏 · 账本            (phone: inside 更多)
//   top right     帮助 · 设置                                              (phone: inside 更多)

export type DrawerTab = "principles" | "relations" | "memories";

export function Rail({
  active,
  onDrawer,
  onBoard,
  onLedger,
  boardOpen = false,
  ledgerOpen = false
}: {
  active: DrawerTab | null;
  onDrawer: (t: DrawerTab) => void;
  onBoard: () => void;
  onLedger: () => void;
  boardOpen?: boolean;
  ledgerOpen?: boolean;
}) {
  const btn = (key: string, icon: string, label: string, on: boolean, click: () => void, hint: string) => (
    <button key={key} type="button" className={`${styles.railBtn} ${on ? styles.railBtnOn : ""}`} onClick={click} aria-pressed={on} title={hint}>
      <Icon name={icon} size={32} />
      <span className={styles.railLabel}>{label}</span>
    </button>
  );
  return (
    <nav className={`${styles.bar} ${styles.rail}`} aria-label="查阅">
      {btn("relations", "relations", "关系", active === "relations", () => onDrawer("relations"), "它和谁熟、谁记着谁")}
      {btn("memories", "diary", "记忆", active === "memories", () => onDrawer("memories"), "它记下的事")}
      {btn("board", "reputation", "公告栏", boardOpen, onBoard, "本周履约榜和城里的大事（B）")}
      {btn("ledger", "scrip", "账本", ledgerOpen, onLedger, "每天的进出（L）")}
    </nav>
  );
}

// ───────────────────────────── drawer ─────────────────────────────

const TAB_LABEL: Record<DrawerTab, string> = { principles: "烙印", relations: "关系", memories: "记忆" };

export function Drawer({
  tab,
  onTab,
  onClose,
  player,
  agents,
  simNowTz,
  imprints
}: {
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  onClose: () => void;
  player: PlayerView | null;
  agents: AgentView[];
  simNowTz: string;
  /** the 烙印 tab's slot / wake controls */
  imprints?: { busy: boolean; error: string | null; onWake: (id: number, sleepId: number | null) => void; onBuySlot: () => void };
}) {
  const ref = useRef<HTMLElement>(null);
  usePanelFocus(ref);
  return (
    <aside ref={ref} className={`${styles.panel} ${styles.drawer}`} aria-label={TAB_LABEL[tab]} tabIndex={-1}>
      <header className={styles.drawerHead}>
        <div className={styles.tabs} role="tablist">
          {(Object.keys(TAB_LABEL) as DrawerTab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${styles.tab} ${tab === t ? styles.tabOn : ""}`} onClick={() => onTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭（Esc）">
          <CloseGlyph />
        </button>
      </header>
      <div className={styles.drawerBody} role="tabpanel">
        {tab === "principles" ? (
          player && imprints ? (
            <PrinciplesPanel player={player} busy={imprints.busy} error={imprints.error} onWake={imprints.onWake} onBuySlot={imprints.onBuySlot} />
          ) : (
            <PrinciplesTab player={player} />
          )
        ) : null}
        {tab === "relations" ? <RelationsTab player={player} agents={agents} tz={simNowTz} /> : null}
        {tab === "memories" ? <MemoriesTab player={player} /> : null}
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
        <Portrait sprite={other?.sprite ?? "rookie"} size={48} />
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

/** whose idea each memory was: your words, what it agreed to / refused, what it did, what came of it */
const MEM_TAG_CLASS: Record<MemoryTag, string> = {
  你的话: "memTagYours",
  它认同: "memTagAgreed",
  它没认同: "memTagRefused",
  被迫: "memTagForced",
  它做了: "memTagMuted",
  后来: "memTagMuted",
  别人: "memTagMuted"
};

function MemoriesTab({ player }: { player: PlayerView | null }) {
  const list = useMemo(() => [...(player?.memories ?? [])].sort((a, b) => b.atMs - a.atMs || b.id - a.id), [player?.memories]);
  const [only, setOnly] = useState<MemoryTag | null>(null);
  const tags = useMemo(() => Array.from(new Set(list.map((m) => m.tag).filter((t): t is MemoryTag => !!t))), [list]);
  if (list.length === 0) return <p className={styles.empty}>它还没有值得记下的事。</p>;
  const shown = only && tags.includes(only) ? list.filter((m) => m.tag === only) : list;
  return (
    <>
      {tags.length >= 2 ? (
        <div className={styles.memFilter} role="group" aria-label="按来源筛选">
          <button type="button" className={`${styles.memFilterBtn} ${only === null ? styles.memFilterOn : ""}`} aria-pressed={only === null} onClick={() => setOnly(null)}>
            全部
          </button>
          {tags.map((t) => (
            <button key={t} type="button" className={`${styles.memFilterBtn} ${only === t ? styles.memFilterOn : ""}`} aria-pressed={only === t} onClick={() => setOnly((cur) => (cur === t ? null : t))}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <ol className={styles.memList}>
        {shown.map((m) => (
          <li key={m.id} className={styles.memItem}>
            <time className={styles.memClock}>{m.clock}</time>
            {m.tag ? <span className={`${styles.memTag} ${styles[MEM_TAG_CLASS[m.tag]]}`}>{m.tag}</span> : null}
            <span className={styles.memText}>{m.text}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

// ───────────────────────────── inspector ─────────────────────────────

/** the town-feed line the player clicked, kept on top of whatever card they jump to next, so the "why am I looking at this" never goes away */
function EventContext({ event, link }: { event: FeedItem | null; link: LinkCtx }) {
  if (!event) return null;
  return (
    <div className={styles.insEvent} aria-label="你点的这件事">
      <h4>
        你点的这件事 · <time>{event.clock}</time>
      </h4>
      <p>
        <LinkedText text={event.text} ctx={link} />
      </p>
    </div>
  );
}

function EventList({ title, lines, link, empty }: { title: string; lines: FeedItem[]; link: LinkCtx; empty?: string }) {
  if (lines.length === 0 && !empty) return null;
  return (
    <div className={styles.insFeed}>
      <h4>{title}</h4>
      {lines.length > 0 ? (
        <ul>
          {lines.map((l) => (
            <li key={l.id}>
              <time>{l.clock}</time>
              <span>
                <LinkedText text={l.text} ctx={link} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.relLast}>{empty}</p>
      )}
    </div>
  );
}

export function Inspector({
  agent,
  isMine,
  rel,
  lines,
  focusEvent,
  where,
  onWhere,
  following,
  onFollow,
  onClose,
  onOpenPrinciples,
  link,
  social,
  extra
}: {
  agent: AgentView;
  isMine: boolean;
  rel: RelationshipView | null;
  /** this resident's recent real events (newest first) */
  lines: FeedItem[];
  /** the town-feed line the player clicked to get here: stays on top while they look around, so the context never disappears */
  focusEvent: FeedItem | null;
  /** "在市集" / "正在去工坊" and the way to that place's card */
  where: string | null;
  onWhere: () => void;
  following: boolean;
  onFollow: () => void;
  onClose: () => void;
  onOpenPrinciples: () => void;
  link: LinkCtx;
  /** the town's social web around this resident (城里的关系); omitted when the snapshot carries none */
  social?: TownSocial;
  extra?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  usePanelFocus(ref);
  const fam = rel ? Math.max(0, Math.min(100, rel.familiarity)) : 0;
  const shown = lines.filter((l) => l.id !== focusEvent?.id);
  return (
    <aside ref={ref} className={`${styles.panel} ${styles.inspector}`} aria-label="居民档案" tabIndex={-1}>
      <header className={styles.insHead}>
        <Portrait sprite={agent.sprite} size={48} player={isMine} />
        <div className={styles.insWho}>
          <strong>
            {isMine ? "★ " : ""}
            {agent.name}
            <span className={styles.insRole}> · {agent.role}</span>
          </strong>
          <span className={styles.insPers}>{agent.personality}</span>
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭（Esc）">
          <CloseGlyph />
        </button>
      </header>
      <EventContext event={focusEvent} link={link} />
      <div className={styles.insNow}>
        <h4>现在</h4>
        <p className={styles.activity}>
          <span className={styles.activityDot} aria-hidden />
          <span>{agent.activityText}</span>
        </p>
        {where ? (
          <button type="button" className={styles.insWhere} onClick={onWhere} title="看看这个地方">
            <Icon name="pin" size={16} />
            <span>{where}</span>
          </button>
        ) : null}
        {agent.reason ? (
          <blockquote className={styles.reason}>
            <Icon name="diary" size={16} className={styles.reasonIcon} />
            <span>
              <b className={styles.reasonLead}>为什么：</b>
              {agent.reason}
            </span>
          </blockquote>
        ) : null}
      </div>
      {!isMine ? (
        <div className={styles.insRel}>
          <h4>和你的 Agent</h4>
          {rel ? (
            <>
              <div className={styles.famRow} title={`和你的 Agent 的熟悉度 ${fam}/100 · 一起完成 ${rel.coopDone} 次`}>
                <span>熟悉度</span>
                <span className={styles.famTrack}>
                  <i style={{ width: `${fam}%` }} />
                </span>
                <span className={styles.famNum}>{fam}</span>
              </div>
              {rel.coopDone > 0 ? <p className={styles.relLast}>一起完成过 {rel.coopDone} 次。</p> : null}
              {rel.incidents.length > 0 ? (
                <ul className={styles.incidents}>
                  {rel.incidents.slice(0, 3).map((inc, i) => (
                    <li key={`${inc.atMs}-${i}`}>
                      <span>{inc.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.relLast}>还没有值得记下的往来。</p>
              )}
            </>
          ) : (
            <p className={styles.relLast}>还没有往来。</p>
          )}
        </div>
      ) : null}
      {social && (social.top.length > 0 || social.held.length > 0 || social.against.length > 0) ? (
        <div className={styles.insTown} aria-label="城里的关系">
          <h4>城里的关系</h4>
          {social.top.length > 0 ? (
            <ul className={styles.townTies}>
              {social.top.map((t) => (
                <li key={t.id} title={`熟悉度 ${t.familiarity}/100 · 一起完成 ${t.coopDone} 次`}>
                  <button type="button" className={styles.tieName} onClick={() => link.onAgent(t.id)}>
                    {t.name}
                  </button>
                  <span className={styles.famTrack}>
                    <i style={{ width: `${Math.max(0, Math.min(100, t.familiarity))}%` }} />
                  </span>
                  <span className={styles.famNum}>{t.familiarity}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.relLast}>还没和谁熟起来。</p>
          )}
          {social.held.map((gr) => (
            <p key={`h${gr.id}`} className={styles.grudge}>
              <b>记着 {gr.name}：</b>
              {gr.text}
            </p>
          ))}
          {social.against.map((gr) => (
            <p key={`a${gr.id}`} className={`${styles.grudge} ${styles.grudgeAgainst}`}>
              <b>被 {gr.name} 记着：</b>
              {gr.text}
            </p>
          ))}
        </div>
      ) : null}
      <EventList title="最近发生的事" lines={shown.slice(0, 6)} link={link} empty={focusEvent ? undefined : "最近没有留下记录。"} />
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

// ───────────────────────────── building card ─────────────────────────────

/** Opened by clicking a building / landmark in the town: who owns it, who is there now, what happened here lately. */
export function LocationCard({
  id,
  label,
  owner,
  here,
  lines,
  focusEvent,
  link,
  onPick,
  onClose,
  onBoard
}: {
  id: string;
  label: string;
  owner: AgentView | null;
  here: AgentView[];
  lines: FeedItem[];
  focusEvent: FeedItem | null;
  link: LinkCtx;
  onPick: (agentId: string) => void;
  onClose: () => void;
  /** the notice board's card opens the board */
  onBoard?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  usePanelFocus(ref);
  return (
    <aside ref={ref} className={`${styles.panel} ${styles.inspector}`} aria-label={`${label}`} data-location={id} tabIndex={-1}>
      <header className={styles.insHead}>
        <span className={styles.locBadge} aria-hidden>
          <Icon name={id === "home" ? "home" : "pin"} size={32} />
        </span>
        <div className={styles.insWho}>
          <strong>{label}</strong>
          <span className={styles.insPers}>{owner ? `${owner.name} 的据点 · ${owner.role}` : "公共场所"}</span>
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭（Esc）">
          <CloseGlyph />
        </button>
      </header>
      <EventContext event={focusEvent} link={link} />
      {id === "board" && onBoard ? (
        <div className={styles.insFeed}>
          <Btn size="sm" variant="primary" onClick={onBoard}>
            看公告栏（B）
          </Btn>
        </div>
      ) : null}
      {owner ? (
        <button type="button" className={styles.locOwner} onClick={() => onPick(owner.id)} title="查看他的近况">
          <Portrait sprite={owner.sprite} size={48} />
          <span>
            <b>{owner.name}</b>
            <i>{owner.activityText}</i>
          </span>
        </button>
      ) : null}
      <div className={styles.insFeed}>
        <h4>现在在这里</h4>
        {here.length > 0 ? (
          <ul className={styles.locHere}>
            {here.map((a) => (
              <li key={a.id}>
                <button type="button" className={styles.locChip} onClick={() => onPick(a.id)}>
                  <Portrait sprite={a.sprite} size={32} player={a.isPlayer} />
                  <span>{a.isPlayer ? `★ ${a.name}` : a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.relLast}>现在没有人在这里。</p>
        )}
      </div>
      <EventList title="这里最近发生的事" lines={lines.filter((l) => l.id !== focusEvent?.id).slice(0, 6)} link={link} empty={focusEvent ? undefined : "这里最近很安静。"} />
    </aside>
  );
}
