// Clock helpers. All timestamps are SIMULATED ms (see lib/types.ts); the zone is
// the world's own (`world.tz`), not the browser's.

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  const hit = fmtCache.get(tz);
  if (hit) return hit;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" });
  }
  fmtCache.set(tz, f);
  return f;
}

export interface ZonedParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

export function fmtClock(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** "今晚 23:00" / "明早 06:00" / "昨天 14:30": a moment in the world's zone, said relative to `nowMs` */
export function fmtWhen(ms: number, nowMs: number, tz: string): string {
  try {
    const a = zonedParts(nowMs, tz);
    const b = zonedParts(ms, tz);
    const diff = Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86_400_000);
    const clock = fmtClock(ms, tz);
    const night = b.h >= 18;
    const morning = b.h < 9;
    if (diff === 0) return `${night ? "今晚" : morning ? "今早" : "今天"} ${clock}`;
    if (diff === 1) return `${night ? "明晚" : morning ? "明早" : "明天"} ${clock}`;
    if (diff === -1) return `昨天 ${clock}`;
    return diff > 0 ? `${diff} 天后 ${clock}` : `${-diff} 天前 ${clock}`;
  } catch {
    return fmtClock(ms, tz);
  }
}

/** "第 N 天": calendar days between the Agent's arrival and `simNow`, in the world's zone (1-based) */
export function dayNumber(simNow: number, createdAtMs: number, tz: string, fallbackDayIndex: number): number {
  try {
    const a = zonedParts(createdAtMs, tz);
    const b = zonedParts(simNow, tz);
    const diff = Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86_400_000);
    return Math.max(1, diff + 1);
  } catch {
    return fallbackDayIndex + 1;
  }
}

/** "hh:mm" countdown (never negative) */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "3 分钟" / "1 小时 20 分" */
export function fmtSpan(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 60_000));
  if (total < 60) return `${total} 分钟`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}
