#!/usr/bin/env bash
# 豆包桌面端话题清单 / 时间查询
# 用法：bash doubao_topic_time.sh
#
# 结论摘要（2026-10-10 实测，豆包 1.83.6）：
#   ·话题列表本体存服务端，本地只有 id，没有 update_time
#   ·唯一带「标题 + 真实时间」的本地来源是 Default/Bookmarks
#   ·Default/History 有标题但 visit_count=0，时间戳是首次运行时间，不可用
#   ·chat_id 是雪花算法，不可反推时间（已验证：前13位当毫秒时间戳会得到 2091年）
#   ·要拿到全部话题的 update_time，只能在App 运行时读内存 store（见第 4 段）

set -u
DB="$HOME/Library/Containers/com.bot.neotix.doubao/Data/Library/Application Support/Doubao/Default"
PY=/Users/hj1993/.workbuddy/binaries/python/versions/3.13.12/bin/python3

echo "############ 1. 完整话题清单（id + 书签里能查到的标题/时间） ############"
"$PY" - "$DB" <<'PY'
import re,os,sys,datetime
WK=11644473600
D=sys.argv[1]
def f(v):
    v=int(v or 0)
    return '—' if v==0 else datetime.datetime.fromtimestamp(v/1e6-WK).strftime('%Y-%m-%d %H:%M:%S')

info={}
# --- Bookmarks：唯一带标题+时间的来源 ---
d=open(D+'/Bookmarks',encoding='utf8',errors='replace').read()
for m in re.finditer(r'"url":\s*"https://www\.doubao\.com/chat/(\d+)"', d):
    cid=m.group(1)
    st=d.rfind('{',0,m.start()); en=d.find('}',m.end()); obj=d[st:en+1]
    # 必须校验是叶子节点，否则会取到外层文件夹的 name（会显示成"书签栏"）
    if '"type": "url"' not in obj: continue
    n=re.search(r'"name":\s*"([^"]*)"',obj)
    da=re.search(r'"date_added":\s*"(\d+)"',obj)
    dl=re.search(r'"date_last_used":\s*"(\d+)"',obj)
    e=info.setdefault(cid,{})
    if n: e['title']=n.group(1)
    if da: e['added']=f(da.group(1))
    if dl: e['used']=f(dl.group(1))

# --- Sessions：拿到完整 id 集合（Bookmarks 只有被收藏过的） ---
ids=set()
sd=D+'/Sessions'
if os.path.isdir(sd):
    for fn in os.listdir(sd):
        try: dd=open(sd+'/'+fn,'rb').read().decode('utf8','replace')
        except Exception: continue
        ids.update(m.group(1) for m in re.finditer(r'doubao\.com/chat/(\d+)', dd))
ids={i for i in ids if len(i)>=16}

print(f'话题 id 总数: {len(ids)}   有标题的: {sum(1 for c in ids if info.get(c,{}).get("title"))}\n')
print(f'{"#":<4}{"chat_id":<20}{"标题":<16}{"加入书签":<20}{"书签最后使用"}')
for i,cid in enumerate(sorted(ids,key=int),1):
    x=info.get(cid,{})
    print(f'{i:<4}{cid:<20}{x.get("title","—"):<16}{x.get("added","—"):<20}{x.get("used","—")}')
PY

echo
echo "############ 2. History 对照（有标题，但时间戳不可信） ############"
cp "$DB/History" /tmp/_db_h.db 2>/dev/null
sqlite3 -header -column /tmp/_db_h.db \
  "select title,
          substr(url, instr(url,'/chat/')+6) as chat_id,
          datetime(last_visit_time/1000000-11644473600,'unixepoch','localtime') as last_visit,
          visit_count
   from urls where url like '%/chat/%';"
echo "注：visit_count=0 且 last_visit 是豆包首次运行时间，不是真实访问时间。"

echo
echo "############ 3. chat_id 能否反推时间？—— 不能（已验证） ############"
"$PY" <<'PY'
ids=[7096133743924226,38415097312215042,38416046427612674,38417238434922754]
import datetime
print('位数分布: 16~17 位（雪花算法：时间位+机器位+序列位，非直接时间戳）')
for i in ids:
    h=int(str(i)[:13])
    print(f'  {i} 前13位当毫秒时间戳 -> {datetime.datetime.fromtimestamp(h/1000)}  ← 明显不合理')
print('结论：只能靠单调递增判断相对先后，不能反推绝对时间。')
PY

echo
echo "############ 4. 拿全部话题时间：DevTools 操作（已验证可用） ############"
cat <<'TXT'
豆包是 Electron 应用，DevTools 可用（日志里有 devtools:// 加载记录佐证）。

步骤：
  1. 打开豆包（侧边栏保持展开）
  2. Cmd+Option+I → 切到 Console
  3. 若提示 "Don't paste code..."，先手打 allow pasting 回车（Chrome 自我保护，非脚本报错）
  4. 粘贴脚本执行：
     - doubao_one_liner.js        ← 极简版，只取标题+侧边栏顺序（145字符，可逐句审查）
     - doubao_export_threadlist.js← 历史话题页，给「时间区间」（昨天/7天/30天/更早）
     - doubao_export_fiber_v2.js  ← 任意页，给**精确 update_time**（唯一能拿精确时刻的）

⚠️ 关键事实：豆包 UI **不显示绝对时间**，只渲染相对分组标签
   （昨天 / 7 天内 / 30 天内 / 一年内 / 更早），绝对时间只在 React store 里。
   所以想要精确时刻必须用 fiber 版。

⚠️ 不要用网上流传的window.useFeedStore.getState() —— 必然 undefined：
   store 在 useFeedStore.prototype._useFeedStore（webpack 闭包内），
   nodeIntegration/contextIsolation 均未开启，window 上没有任何 store 引用。
TXT
echo "脚本目录: $(dirname "$0")"