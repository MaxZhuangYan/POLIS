# 地图：修改、新建、校验

Polis 的地图是标准的 Tiled 地图（`.tmj`，JSON 格式）。游戏在客户端读取它：Phaser 负责绘制，`app/components/town/tiled.ts` 把它解析成「地点 / 门 / 住处 / 可点击区域 / 寻路网格」。服务端只认 LocationId，不知道任何坐标，所以**换地图不需要改一行游戏逻辑**。

```
public/assets/town/polis-town.tmj   正式地图（64×42），由 scripts/build-town-map.mjs 生成
public/assets/town/tileset.png      挤压过的图集（margin 1，spacing 2）
app/components/town/maps.ts          地图注册表
scripts/map-check.mjs                校验器（npm run map:check）
```

## 三条命令

```bash
npm run map:check                         # 校验所有注册的地图（改完地图先跑这个）
npm run map:check -- path/to/x.tmj        # 校验一个文件
npm run map:preview -- --out /tmp/a.png   # 不开浏览器，渲染一张 PNG（需要 python3 + Pillow；--map x.tmj 指定别的图）
npm run map:build                         # 重新生成正式地图（会覆盖 polis-town.tmj）
```

在游戏里看：`npm run dev:test`，打开 `http://localhost:3000/dev/town`（只在开发 / 测试模式可用），工具栏有「地图·…」切换按钮，或者用 `?map=<id>`；加 `&debug=1` 会画出碰撞格、站位、门和可点击区域。

## 方式一：改现有地图

两种做法，选一种，**不要混用**：

- **改生成器**（推荐，可复现）：`scripts/build-town-map.mjs` 第 1 节是可读的布局数据（道路、建筑、摆件、地点范围），改完 `npm run map:build`，再 `npm run map:check`。
- **直接用 Tiled 打开 `polis-town.tmj` 手改**：改完保存，之后**别再运行 `map:build`**（会覆盖你的手改）。

## 方式二：新建一张地图

1. **新建地图**：Tiled → New Map：Orthogonal，Tile Layer Format = **CSV**，Tile render order = Right Down，**取消 Infinite**，格子 **16×16**。
2. **图集**：New Tileset → 选 PNG，勾 **Embed in map**。用我们挤压过的 `public/assets/town/tileset.png` 时，Margin = **1**，Spacing = **2**（挤压是为了避免缩放时出现接缝；自己的图集用 `python3 scripts/extrude-tileset.py` 处理后同样设 1 / 2）。已经是外部 tileset 的，用 Map → **Embed Tilesets**。可以有多个图集，图层里混用也没问题。
3. **图块层**（名字必须一致，从下往上画）：

   | 图层 | 必需 | 作用 |
   |---|---|---|
   | `ground` | ✓ | 地面。出现最多的那块地砖，也会铺到地图外缘（镜头滑出地图时看到的地面） |
   | `paths` |  | 道路、广场铺装 |
   | `water` |  | 水面 |
   | `deco` |  | 花草、石头、小摆件（能不能走由 `collision` 决定） |
   | `buildings` |  | 建筑下半部、树干等，画在居民下面 |
   | `collision` | ✓ | **不绘制**。任何非空格 = 走不过去。这是唯一的碰撞约定 |
   | `above` |  | 屋顶、树冠、牌坊横梁，画在居民**上面**（居民走到下面会被遮住） |

4. **移动代价**（可选）：在图集里选中图块，加自定义属性 `cost`（float，>0）。道路 / 广场 1，空地 2，草地 2.5，可通行摆件 4。查找顺序：deco → paths → ground；没有 `cost` 的格子按 1 算。居民会优先走便宜的路。
5. **对象层** 叫 `locations`，对象的 **Class**（旧版 Tiled 叫 Type）决定用途：

   | Class | 形状 | Name | 自定义属性 | 用途 |
   |---|---|---|---|---|
   | `location` | 矩形 | LocationId | `label`（中文名，string）、`owner`（NPC id，可空） | 居民站着干活的区域。同名多个矩形 = 同一地点的几块区域 |
   | `door` | 点 | 随意 | `location`（LocationId） | 进入该地点的那一格（必须可走） |
   | `home_door` | 点 | 随意 | `slot`（int，从 0 连续编号） | 住处门口。0 = 玩家的 Agent，1–6 = 六位居民，**至少 7 个**；多出来的给以后的居民 |
   | `interactable` | 矩形 | 随意 | `location`（+ 可选 `slot`） | 鼠标悬停 / 点击的区域（建筑、地标） |

   需要的 LocationId（`lib/types.ts`）：`archive` 档案馆、`market` 市集、`plaza` 广场、`workshop` 工坊、`outskirts` 城邦外围、`mediation` 调解所、`hall` 议事厅、`board` 公告栏、`gate` 城门、`home` 住处。每个都要有 `location` 区域和 `door`（`home` 用 `home_door`）。每个地点建议至少 3 个站位（站位从区域里自动挑）。
6. **注册**：在 `app/components/town/maps.ts` 的 `MAPS` 里加一项（id、中文名、`tmj` 站点路径、一句说明）。图片路径写在 `.tmj` 里，相对于 `.tmj` 文件解析，所以把 `.tmj` 和图集放进同一个 `public/` 子目录最省事。
7. **校验**：`npm run map:check`，直到显示 ✓。
8. **试玩**：`/dev/town?map=<id>`；要让正式游戏用它，构建 / 启动前设 `NEXT_PUBLIC_POLIS_MAP=<id>`（这个变量在构建时写进前端，改了要重启 dev 或重新 build）。

## 校验器查什么

错误（必须修，`map:check` 退出码 1）：方向不是正交、无限地图、格子不是 16×16；缺 `ground` / `collision`；图层格子数不等于宽×高；Base64 / 压缩 / 分块存储；外部图集、图片集合（image collection）、图片不存在、图片尺寸和 `.tmj` 记录不符、margin / spacing 算出来的列数不对；有格子的 gid 不属于任何图集；`cost` 不是正数；缺地点区域或门；`home_door` 不足 7 个或编号不连续；门在碰撞格上；从城门走不到某个门。

警告：缺可选图层、游戏不会绘制的图层名、被 `above` 遮住的门、站位少于 3 个的地点。

## 加一个全新的地点（LocationId）

地图只是其中一步；新地点要在下面几处一起登记（`npm run typecheck` 会帮你找漏的）：

1. `lib/types.ts`：`LocationId` 联合类型。
2. `app/components/town/tiled.ts`：`LOCATION_IDS`。
3. `lib/snapshot.ts`：`VALID_LOC`。
4. `lib/content.ts`：`LOCATION_NAMES`（中文名）；如果有活在这里做，在 `TASK_TEMPLATES` 里把任务的 `location` 设成它（按行业的默认地点在 `SECTOR_LOCATION`）。
5. 地图：`location` 区域 + `door`（+ 可选 `interactable`）；生成器的布局数据在 `scripts/build-town-map.mjs`。
6. 可选：`app/components/game/scenes/TownScene.ts` 里标题画面镜头巡游的地点顺序；`scripts/test-pathfinding.mjs` 的路线抽查表。
7. `npm run map:check && npm run test:pathfinding && npm run typecheck`。
