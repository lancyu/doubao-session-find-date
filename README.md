# 豆包话题时间导出工具

从**豆包桌面客户端**（macOS）导出话题（对话）列表，含**精确的最后更新时间**。

灵感来自一个很朴素的需求：豆包侧边栏的话题排序是按时间排的，但界面上只显示「昨天 / 7 天内 / 30 天内 / 更早」这类相对标签，**看不到具体时刻**。这个工具把精确时间挖出来。

---

## 背景：豆包的话题是怎么排序的

逆向前端代码（版本 1.83.6）得到的结论：

- 排序**只看两个字段**：`pinned`（是否置顶）和 `update_time`（最后活跃时间，**秒级**时间戳）
- **不按标题**、**不按创建时间**、**不按打开时间**
- 列表顺序由服务端 `POST /samantha/im/conversation/list` 下发（`batch_size=20`，cursor 翻页），服务端已按 `update_time` 倒序
- 前端唯一的重排发生在插入新会话时：`pinned=true` 插到索引 0；否则插到「第一个非置顶项」之前
- 会话状态更新时若只有 `update_time` 变化，是**原地替换而不重排**

所以「精确的 update_time」才是排序的真实依据。

---

## 快速开始

### 方式一：导出精确时间（推荐）

1. 打开豆包，**保持侧边栏展开**（能看到话题列表）
2. `Cmd + Option + I` 打开 DevTools，切到 **Console**
3. 若提示 `Don't paste code...`，先手打 `allow pasting` 回车
   （Chrome 的自我保护机制，非脚本报错）
4. 粘贴 [`doubao-export-dates.js`](doubao-export-dates.js) 的全部内容，回车
5. 结果会自动复制到剪贴板，同时在 Console 打印表格

输出示例：

```
序号 chat_id                 标题      置顶   最后更新                 来源
1    38417238434922754       肥胖课题   true   2026/3/17 19:58:14      fiber(7).conversation
2    38439430725401858       C++ 学习   false  2026/10/10 09:27:21     fiber(7).conversation
```

### 方式二：只要标题和顺序（最简单）

粘贴 [`doubao-export-titles.js`](doubao-export-titles.js)。145 个字符，可逐句审查：

```js
copy([...document.querySelectorAll('[data-testid="chat_list_thread_item"]')].map((e,i)=>(i+1)+'. '+e.innerText.trim().split('\n')[0]).join('\n'))
```

### 方式三：只要时间区间（不需要 DevTools 技巧）

进入豆包「查看全部对话」页，**先滚动到底**让懒加载完成，然后粘贴
[`doubao-export-groups.js`](doubao-export-groups.js)。给出「置顶 / 昨天 / 7 天内 / 30 天内 / 更早」分组。

### 方式四：纯本地扫描（不碰 DevTools）

```bash
bash local_scan.sh
```

扫描本地 Chromium 数据目录，列出能查到的话题 id 和书签里留存的标题/时间。
**局限**：只有被收藏进书签的话题才有标题和时间，其余只有 id（详见下文「能力边界」）。

---

## 能力边界（先看清再动手）

| 数据 | 能否拿到 | 说明 |
|---|---|---|
| 话题标题 | ✅ | DOM 上直接有 |
| 侧边栏顺序 | ✅ | `conversationLinks` 的实际顺序 |
| 精确 `update_time` | ✅ | 需用主脚本（走 React fiber） |
| `chat_id` | ✅ | props 里有`conversation_id` |
| 是否置顶 | ✅ | props 里有 `pinned` |
| 绝对时间（不运行客户端） | ❌ | **不存在本地**，见下|
| 完整列表（不运行客户端） | ❌ | **不存在本地** |

**为什么不能完全离线获取**：话题列表本体存在服务端，本地不缓存。
翻遍了 Local Storage、IndexedDB、Tea 埋点库、History、Bookmarks，
能捞到的只有零散 id 残片（详见 `local_scan.sh` 的输出说明）。

---

## 技术原理

豆包是 Electron 壳，前端是 React + zustand。关键链条：

```
侧边栏 DOM 节点  [data-local-item]
  └─ __reactFiber$xxx  → fiber(0)  props = <a> 标签属性（无数据）
       └─ fiber(6)     包装组件
            └─ fiber(7)  props.conversation ← update_time 在这里
                 conversation 全部键:
                 conversation_type, conversation_id, message_cursor,
                 last_section_id, icon_url, name, bot_id, tags,
                 update_time, pinned, icon_image, badge_count,
                 read_badge_count, extra, latest_artifact, thread_id
```

store 藏在 webpack 闭包里（`useFeedStore.prototype._useFeedStore`），
**没有挂在 window 上**，所以 `window.useFeedStore.getState()` 必然是 `undefined`。
`nodeIntegration` / `contextIsolation` 均未开启，只能走 fiber 这条路。

---

## 踩坑记录

这一节记录过程中失败的所有尝试，**避免后来人重走弯路**。

### ❌ 以为「话题列表不在本地」就到此为止

最初的结论是「本地查不到时间」。**错在只翻了 leveldb，漏了 Chromium 数据目录**。
后来在 `Default/Bookmarks` 里找到了带真实时间戳的书签条目。
→ 结论：判断「本地有没有数据」之前，把 `Default/` 下的
`History`、`Bookmarks`、`Sessions`、`Favicons`、`IndexedDB` 都翻一遍。

### ❌ 误判 History 的时间戳

`Default/History` 的 `urls` 表里有话题标题，但 `visit_count=0`，
且 `last_visit_time` 是**豆包首次运行时间**（所有条目时间几乎相同）。
→ `visit_count=0` 是强信号：该记录不可信。

### ❌ 反复猜 React 内部结构

连续三版脚本（v1/v2/v3）都在**猜** store 藏在哪、遍历多少层 hook，逐一失败。
真正的转折点是**让脚本打印诊断信息**：逐层输出 fiber 组件名 + `propsKeys` +
字段的 `typeof` 和实际值。用户跑一次，根因立刻明确。

→ **教训：读内部数据时，脚本必须内置「打印实际类型与值」的诊断，
而不是只做判断然后报「没找到」**。判断失败时无信息，等于没调试。

### ❌ 选择器写错（两次）

| 场景 | 正确选择器 |
|---|---|
| 侧边栏每条话题 | `[data-local-item]` |
| 历史话题页每条话题 | `[data-testid="thread_detail_item"]` |
| 历史话题页时间分组标题 | `p[class*="timeline-text"]` |

一开始把历史页写成了 `chat_list_thread_item`（那是侧边栏的），`querySelectorAll` 返回空数组。

### ❌ 「置顶」分组不渲染标题

源码是 `e.timezone !== ee.Pined ? jsx("p", {className: timeline-text}) : null`
——置顶组**没有标题元素**。所以「遇到分组标题就切段」的逻辑会让置顶项归到错误的组。
→ 用「第一个分组标题之前出现的项= 置顶区」兜底。

### ❌ `Array.push(a, b)` 当二元组用

```js
candidates.push(`fiber(${up})`, value)          // ❌ 推入 2 个独立元素
candidates.push([`fiber(${up})`, value])         // ✅ 推入 1 个二元组
```

错误延后到下游 `for (const [label, obj] of candidates)` 才爆成
`TypeError: .for is not iterable` —— 行号和真正的原因差了 7 行，很难定位。

### ❌ 深度限制差一层

fiber 链第 7 层才有 `conversation`，而搜索上限写的是 6 层。**差一层，全盘失败**。
→ 上限至少 60 层（实际约 60 层就到根），并`f.return == null` 为止。

### ❌ 用 `typeof === 'number'` 判断时间戳

```js
typeof conv.update_time === 'number' && conv.update_time > 1e9   // ❌ 漏
```

`update_time` 来自 protobuf，int64 在 JSON 里**经常被序列化成字符串**，
也可能带毫秒/微秒单位、或包成 `{seconds, nanoseconds}`。
必须按位数宽松归一：

```js
if (n > 1e15) n /= 1e6;        // 微秒
else if (n > 1e12) n /= 1e3;   // 毫秒
if (n < 1e8) return null;      // 早于 1973，不合理
```

### ❌ 多选择器返回重复元素

`document.querySelectorAll('a, b')` 会把同时命中 a 和 b 的元素**返回两次**。
→ `[...new Set([...nodes])]` 去重。

### ❌ 试图绕过用户直接远程读取

试过 `open -a Doubao --args --remote-debugging-port=9222`，**参数被 app 忽略**（它自占 49853）；
`127.0.0.1:49853` 也不是 CDP（`/json/version` 等 10 个路径全 404）。

### ❌ chat_id 反推时间

雪花算法 ID，前 13 位当毫秒时间戳算出来是 **2091 年**。
也试过用已知锚点做线性标定，结果自相矛盾（锚点被推到 10 月，与书签记录的 3 月冲突）。
→ 只能靠单调递增判断**相对先后**，不能反推绝对时间。**不要编造时间。**

---

## 本地数据目录速查

```
~/Library/Containers/com.bot.neotix.doubao/Data/Library/Application Support/Doubao/
├── Default/
│   ├── Bookmarks          ← 唯一带「标题 + 真实时间」的来源（date_added / date_last_used）
│   ├── History            ← 有标题，但 visit_count=0，时间戳不可信
│   ├── Sessions/Tabs_*    ← 完整话题 id 集合（最全的 id 来源）
│   ├── Favicons           ← 只有 id 残片
│   └── Local Storage/     ← leveldb，埋点与 A/B 配置
└── gecko_cache/.../static/js/   ← 前端打包 JS（254 个文件，逆向源码用）
```

两个时间格式陷阱：

- **WebKit 时间戳**（Bookmarks/History）：微秒，Unix 秒 = `value/1e6 - 11644473600`
- **`visits` 表列名是 `url`**，不是网上教程常写的 `url_id`

---

## 安全说明

所有脚本：

- 只读 DOM 与 React 内部数据
- **无** `fetch` / `XMLHttpRequest` / `WebSocket`
- **无** `eval` / `new Function`
- **不读** cookie / `localStorage` / 凭据
- 唯一副作用是写剪贴板（`navigator.clipboard.writeText`）

唯一需要注意的是 Chrome 的粘贴保护：首次粘贴要手打 `allow pasting` 回车。
这本身是个好机制 —— 它拦的是「诱导粘贴陌生代码」，说明值得警惕。
本仓库脚本均可逐行审查后再执行。

---

## 已知限制

- 仅适配 macOS，豆包客户端 1.83.6（Chromium 135）
- 豆包更新后前端混淆产物变化，`fiber` 深度和 `props` 结构可能改变，
  届时用脚本内置的诊断输出重新定位即可（不必猜）
- 侧边栏需保持展开，否则 `querySelectorAll` 返回空
- 不解密 Keychain 中的登录 Cookie，不模拟接口调用

---

## 文件说明

| 文件 | 用途 |
|---|---|
| `doubao-export-dates.js` | **主脚本**，导出精确 `update_time` |
| `doubao-export-groups.js` | 历史话题页，导出时间区间分组 |
| `doubao-export-titles.js` |极简版，只要标题 + 顺序（145 字符） |
| `local_scan.sh` | 本地数据目录扫描，不碰 DevTools |

---

## License

MIT