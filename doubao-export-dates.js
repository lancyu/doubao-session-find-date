/* 豆包话题时间导出 —— 主脚本（精确 update_time）
 *
 * 用途：从豆包桌面端（macOS）导出话题列表，含**精确的最后更新时间**。
 *
 * 为什么需要它：
 *   豆包 UI 只渲染相对时间分组（昨天 / 7 天内 / 30 天内 / 更早），
 *   绝对时间戳只存在于 React 组件的 props 里，DOM 上看不到。
 *   本脚本沿 React fiber 链上溯，读 props.conversation.update_time。
 *
 * 关键实现点（都是踩过坑总结的）：
 *   1. 侧边栏每条话题的 DOM 锚点是 data-local-item
 *   2. update_time 在 fiber 链第 7 层的 props.conversation 里
 *      （DOM 自身的 props 是 <a> 标签的，不含数据，必须往上走）
 *   3. update_time 可能是 number / 数字字符串 / protobuf {seconds}
 *      —— 用 typeof === 'number' 严格判断会漏，必须按位数宽松归一
 *
 * 安全说明：只读 DOM 与 React 内部数据，无网络请求、无 eval、不读取cookie。
 *
 * 用法：豆包任意页面（侧边栏展开）→ DevTools Console → 粘贴执行
 */
(() => {
  const SEL = [
    '[data-local-item]',
    '[data-testid="chat_list_thread_item"]',
    '[data-testid="thread_detail_item"]',
    '[data-testid="chat_list_item"]'
  ].join(',');

  let nodes = [...new Set([...document.querySelectorAll(SEL)])];
  if (!nodes.length) { console.warn('没找到话题节点，请确认侧边栏已展开。'); return; }
  console.log(`抓到 ${nodes.length} 个话题节点`);

  /* 宽松取时间戳：接受 number / 数字字符串 / {seconds} / {ms} */
  function toTs(v) {
    if (v === null || v === undefined) return null;
    let n = v;
    if (typeof n === 'object') {
      // 兼容 { seconds, nanoseconds } 这类 protobuf 结构
      if (typeof n.seconds === 'number') n = n.seconds;
      else if (typeof n.seconds === 'string') n = Number(n.seconds);
      else return null;
    }
    n = Number(n);
    if (!isFinite(n) || n <= 0) return null;
  // 毫秒(13位) / 微秒(16位) / 秒(10位) 都归一到秒
    if (n > 1e15) n = n / 1e6;
    else if (n > 1e12) n = n / 1e3;
    if (n < 1e8) return null;// 早于 1973，不合理
    return n;
  }

  function extract(startEl) {
    const fk = Object.keys(startEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!fk) return null;

    const layers = [];
    const pk = Object.keys(startEl).find(k => k.startsWith('__reactProps$'));
    if (pk) layers.push(['DOM.props', startEl[pk]]);

    let f = startEl[fk], up = 0;
    while (f && up < 60) {
      if (f.memoizedProps) layers.push(['fiber(' + up + ')', f.memoizedProps]);
      if (f.pendingProps) layers.push(['fiber(' + up + ').pending', f.pendingProps]);
      f = f.return; up++;
    }

    let ts = null, from = null, cid = null, name = null, pinned = null;

    for (let i = 0; i < layers.length && ts === null; i++) {
      const label = layers[i][0];
      const p = layers[i][1];
      if (!p || typeof p !== 'object') continue;

      // 主路径：props.conversation
      const conv = p.conversation;
      if (conv && typeof conv === 'object') {
        const t = toTs(conv.update_time);
        if (t) { ts = t; from = label + '.conversation'; }
        if (!cid && typeof conv.conversation_id === 'string') cid = conv.conversation_id;
        if (!name && typeof conv.name === 'string') name = conv.name;
        if (pinned === null && typeof conv.pinned === 'boolean') pinned = conv.pinned;
      }

      // 历史话题页：props.item
      if (ts === null) {
        const item = p.item;
        if (item && typeof item === 'object') {
          const t = toTs(item.update_time);
          if (t) { ts = t; from = label + '.item'; }
          if (!cid && typeof item.conversation_id === 'string') cid = item.conversation_id;
          if (!name && typeof item.name === 'string') name = item.name;
        }
      }

      // 顶层
      if (ts === null) {
        const t = toTs(p.update_time);
        if (t) { ts = t; from = label; }
      }

      // id 兜底
      if (!cid && typeof p.conversation_id === 'string') cid = p.conversation_id;
      if (!cid && p.conversationLink && typeof p.conversationLink.conversationId === 'string') {
        cid = p.conversationLink.conversationId;
      }
    }

    return { ts, from, cid, name, pinned };
  }

  const rows = nodes.map((el, i) => {
    let r = {};
    try { r = extract(el) || {}; }
    catch (err) { console.warn('第 ' + (i + 1) + ' 条异常：', err && err.message); }

    const titleEl = el.querySelector('[data-testid="thread_detail_item_title"]');
    const title = ((titleEl && titleEl.textContent) || '').trim() || r.name || '(无标题)';

    let cid = r.cid;
    if (!cid) {
      const a = el.querySelector('a[href*="/chat/"]') || (el.tagName === 'A' ? el : null);
      if (a && a.getAttribute) {
        const m = (a.getAttribute('href') || '').match(/\/chat\/(\d+)/);
        if (m) cid = m[1];
      }
    }

    return {
      序号: i + 1,
      chat_id: cid || '—',
      标题: String(title).slice(0, 30),
      置顶: r.pinned === null ? '—' : r.pinned,
      最后更新: r.ts ? new Date(r.ts * 1000).toLocaleString() : '(没挖到)',
      来源: r.from || '—'
    };
  });

  const ok = rows.filter(r => r.最后更新 !== '(没挖到)').length;
  console.log(`\n共 ${rows.length} 条，其中 ${ok} 条取到 update_time`);
  console.table(rows);

  if (ok) {
    const csv = ['序号,chat_id,标题,置顶,最后更新']
      .concat(rows.map(r => [r.序号, r.chat_id, '"' + String(r.标题).replace(/"/g, '""') + '"', r.置顶, r.最后更新].join(',')))
      .join('\n');
    navigator.clipboard && navigator.clipboard.writeText(csv).then(
      () => console.log('CSV 已复制'),
      () => console.log('复制失败，手动复制表格')
    );
    console.log('CSV 预览：\n' + csv);
  } else {
    console.log('\n仍全部失败 → 请贴这段诊断（重点看 update_time 的**实际类型和值**）：');
    const el = nodes[0];
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    let f = fk ? el[fk] : null, up = 0;
    while (f && up < 12) {
      const p = f.memoizedProps || {};
      if (p.conversation) {
        const c = p.conversation;
        console.log(`  fiber(${up}).conversation.update_time =`, JSON.stringify(c.update_time),
          '| typeof =', typeof c.update_time);
        console.log(`  fiber(${up}).conversation 键:`, Object.keys(c).join(','));
      }
      f = f.return; up++;
    }
  }
})();