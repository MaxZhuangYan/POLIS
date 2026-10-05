// The keyboard map, in one place: GameShell's key handler implements it and the key-help overlay (? / H) lists it.
// No Phaser import.
//
//   camera   W A S D / arrow keys   pan (any pan stops "follow")
//            Q E  or  - =           zoom out / in by one step
//            Space                  locate my Agent and follow it
//   guardian 1 2 3                  choose that option of the open fork card
//            N                      留言      P  明信片      R  烙印 drawer
//   screen   F                      toggle the town feed
//            Esc                    close the top modal / drawer / popover
//            ? or H                 this help
//
// Keys are ignored while typing in an input / textarea, and with Ctrl / Cmd / Alt held (so browser shortcuts such as
// Cmd+R keep working). Touch play is unchanged: drag to pan, pinch to zoom, tap.

export interface KeyHelpRow {
  keys: string[][];
  label: string;
}

export interface KeyHelpGroup {
  title: string;
  rows: KeyHelpRow[];
}

export const KEY_HELP: KeyHelpGroup[] = [
  {
    title: "镜头",
    rows: [
      { keys: [["W", "A", "S", "D"], ["↑", "←", "↓", "→"]], label: "移动镜头（会停止跟随）" },
      { keys: [["Q", "E"], ["-", "="]], label: "缩小 / 放大" },
      { keys: [["Space"]], label: "找到我的 Agent，并跟随它" }
    ]
  },
  {
    title: "守护",
    rows: [
      { keys: [["1", "2", "3"]], label: "回应岔路：选第 1 / 2 / 3 个选项" },
      { keys: [["N"]], label: "留言" },
      { keys: [["P"]], label: "明信片" },
      { keys: [["R"]], label: "烙印（记忆槽位、沉睡的烙印、默契）" },
      { keys: [["B"]], label: "公告栏：本周履约榜和城里的事" },
      { keys: [["L"]], label: "账本：每天的进出（日结）" }
    ]
  },
  {
    title: "界面",
    rows: [
      { keys: [["F"]], label: "小镇动态：展开 / 收起" },
      { keys: [["Esc"]], label: "关闭最上面的窗口或抽屉" },
      { keys: [["?"], ["H"]], label: "这张按键说明" }
    ]
  }
];

/** panning keys by KeyboardEvent.code (positional, so WASD also works on AZERTY keyboards) */
export const PAN_CODES: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0]
};

/** true when the key event came from somewhere the player is typing */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
