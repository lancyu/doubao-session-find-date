# 豆包话题时间导出

从**豆包桌面客户端**（macOS）导出话题（对话）列表，含**精确的最后更新时间**。

背景：豆包侧边栏的话题按时间排序，但界面只显示「昨天 / 7 天内 / 30 天内 / 更早」这类相对标签，看不到具体时刻。这个工具把精确时间挖出来。

---

## 使用方法

1. 打开豆包，**保持侧边栏展开**（能看到话题列表）
2. `Cmd + Option + I` 打开 DevTools，切到 **Console**
3. 若提示 `Don't paste code...`，先手打 `allow pasting` 回车
   （Chrome 的自我保护机制，不是脚本报错）
4. 粘贴 [`doubao-export-dates.js`](doubao-export-dates.js) 的全部内容，回车
5. 结果自动复制到剪贴板，同时在 Console 打印表格

输出示例：

```
序号 chat_id                 标题      置顶   最后更新              来源
1    38417238434922754       肥胖课题   true   2026/3/17 19:58:14   fiber(7).conversation
2    38439430725401858       C++ 学习   false  2026/10/10 09:27:21  fiber(7).conversation
```

导出的字段：

| 字段 | 说明 |
|---|---|
| `序号` | 侧边栏实际顺序 |
| `chat_id` | 话题 ID |
| `标题` | 话题标题 |
| `置顶` | 是否置顶 |
| `最后更新` | **精确时间**（到秒） |

---

## 排序逻辑

逆向前端代码（豆包 1.83.6）得到的结论：

- 排序**只看两个字段**：`pinned`（是否置顶）和 `update_time`（最后活跃时间，秒级时间戳）
- **不按标题**、**不按创建时间**、**不按打开时间**
- 列表顺序由服务端 `POST /samantha/im/conversation/list` 下发（`batch_size=20`，cursor翻页），服务端已按 `update_time` 倒序
- 前端唯一的重排发生在插入新会话时：`pinned=true` 插到索引 0；否则插到「第一个非置顶项」之前
- 会话状态更新时若只有 `update_time` 变化，是**原地替换而不重排**

所以「精确的 `update_time`」才是排序的真实依据。

---

## 实现原理

豆包是 Electron 壳，前端是 React + zustand。绝对时间只存在于组件 props 里，DOM 上看不到：

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

store 藏在 webpack 闭包里（`useFeedStore.prototype._useFeedStore`），**没有挂在 window 上**，所以 `window.useFeedStore.getState()` 必然是 `undefined`。
`nodeIntegration` / `contextIsolation` 均未开启，只能走 fiber 这条路。

三个关键点：

1. **锚点**是 `[data-local-item]`
2. **深度**：fiber 链第 7 层才有 `conversation`（DOM 自身的 props 是 `<a>` 标签的，不含数据）
3. **类型**：`update_time` 可能是 number / 数字字符串 / protobuf `{seconds}`，必须按位数宽松归一

---

## 踩坑记录

记录所有失败尝试，避免重走弯路。

### ❌ 以为「本地没有数据」就到此为止

最初的结论是「本地查不到时间」。**错在只翻了 leveldb，漏了 Chromium 数据目录** —— `Default/Bookmarks` 里其实有带真实时间戳的条目。

### ❌ 误判 History 的时间戳

`Default/History` 有话题标题，但 `visit_count=0`，且 `last_visit_time` 是**豆包首次运行时间**（所有条目时间几乎相同）。
→ `visit_count=0` 是强信号：该记录不可信。

### ❌ 连续三版靠猜 React 内部结构

v1/v2/v3 都在猜 store 藏在哪、遍历多少层 hook，逐一失败。
真正的转折点是**让脚本打印诊断信息**：逐层输出 fiber 组件名 + `propsKeys` + 字段的 `typeof` 和实际值。用户跑一次，根因立刻明确。

> **教训**：读内部数据时，脚本必须内置「打印实际类型与值」的诊断。只做判断然后报「没找到」，等于没调试。

### ❌ 选择器写错

一开始把历史话题页写成 `chat_list_thread_item`（那是侧边栏的），`querySelectorAll` 返回空数组。
→ 侧边栏用 `[data-local-item]`，历史页才是 `[data-testid="thread_detail_item"]`。

### ❌ 深度限制差一层

fiber 链第 7 层才有 `conversation`，而搜索上限写了 6 层。**差一层，全盘失败**。
→ 上限至少 60 层，直到 `f.return == null`。

### ❌ 用 `typeof === 'number'` 判断时间戳

```js
typeof conv.update_time === 'number' && conv.update_time > 1e9   // ❌ 会漏
```

`update_time` 来自 protobuf，int64 在 JSON 里**经常被序列化成字符串**，也可能带毫秒/微秒单位、或包成 `{seconds, nanoseconds}`。
必须按位数宽松归一：

```js
if (n > 1e15) n /= 1e6;        // 微秒
else if (n > 1e12) n /= 1e3;   // 毫秒
if (n < 1e8) return null;      // 早于 1973，不合理
```

### ❌ `Array.push(a, b)` 当二元组用

```js
candidates.push(`fiber(${up})`, value)      // ❌ 推入 2 个独立元素
candidates.push([`fiber(${up})`, value])     // ✅ 推入 1 个二元组
```

错误延后到下游 `for (const [label, obj] of candidates)` 才爆成 `TypeError: .for is not iterable` —— 行号和真正原因差了 7 行，很难定位。

### ❌ 多选择器返回重复元素

`document.querySelectorAll('a, b')` 会把同时命中 a 和 b 的元素**返回两次** → 需`[...new Set([...nodes])]` 去重。

### ❌ 试图绕过用户直接远程读取

`open -a Doubao --args --remote-debugging-port=9222` —— **参数被 app 忽略**（它自占 49853）；
`127.0.0.1:49853` 也不是 CDP（`/json/version` 等 10 个路径全 404）。

### ❌ 试图用 chat_id 反推时间

雪花算法 ID，前 13 位当毫秒时间戳算出来是 **2091 年**；用已知锚点做线性标定则自相矛盾。
→ 只能靠单调递增判断**相对先后**。**不要编造时间。**

---

## 安全说明

- 只读 DOM 与 React 内部数据
- **无** `fetch` / `XMLHttpRequest` / `WebSocket`
- **无** `eval` / `new Function`
- **不读** cookie / `localStorage` / 凭据
- 唯一副作用是写剪贴板

需要解除 Chrome 的粘贴保护时，建议先读一遍脚本 —— 它可逐行审查，本身也是最好的安全实践。

---

## 已知限制

- 仅适配 macOS，豆包客户端 1.83.6（Chromium 135）
- 豆包更新后前端产物变化，`fiber` 深度和 `props` 结构可能改变，届时用脚本内置的诊断输出重新定位即可（不必猜）
- 侧边栏需保持展开，否则抓不到节点
- 不解密 Keychain 中的登录 Cookie，不模拟接口调用

---

## License

MIT