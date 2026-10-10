/* 豆包历史话题页导出 —— 修正版
 *
 * 修正了上一版两个错误：
 *   1. 选择器错了：历史话题页的 data-testid 是 "thread_detail_item"，
 *      不是 "chat_list_thread_item"（那是侧边栏的）
 *   2. 「置顶」分组不渲染标题（代码里是 e.timezone !== ee.Pined 才渲染 <p>），
 *      所以置顶项前面没有分组标题，需要靠"上一组还没出现时归为置顶"来兜底
 *
 * ⚠️ 关于时间的重要事实（读源码确认）：
 *   豆包 UI **不显示绝对时间戳**，只渲染相对分组标签：
 *     昨天 / 7 天内 / 30 天内 / 一年内 / 更早
 *   绝对时间 update_time 存在 React store 里，不在 DOM 上。
 *   所以本脚本给的是「时间区间」而非精确时刻。要精确时刻请用 v2（fiber 版）。
 *
 * 用法：
 *   1. 进入历史话题列表页（点「查看全部对话」）
 *   2. 滚动到底，让懒加载全部加载出来
 *   3. Console 执行
 */
(() => {
  const ITEM = '[data-testid="thread_detail_item"]';
  const GROUP = 'p[class*="timeline-text"]';

  const items = [...document.querySelectorAll(ITEM)];
  if (!items.length) {
    console.warn('没抓到话题项。检查：① 是否在历史话题列表页  ② 是否已滚动加载  ③ 选择器是否仍为 thread_detail_item');
    return;
  }

  /* 策略：按 DOM 顺序遍历，分组标题 <p> 出现即切换当前区间；
     第一个分组标题之前出现的项 = 置顶区（源码里置顶组不渲染标题）。 */
  const rows = [];
  let group = '置顶区（源码中该组不渲染标题）';
  const nodes = [...document.querySelectorAll(`${GROUP}, ${ITEM}`)];

  for (const el of nodes) {
    if (el.matches(GROUP)) {
      const t = (el.textContent || '').trim();
      if (t) group = t;
      continue;
    }
    const titleEl = el.querySelector('[data-testid="thread_detail_item_title"]');
    const title = (titleEl?.textContent || '').trim();
    if (!title) continue;
    const pinIcon = !!el.querySelector('[data-testid="chat_list_item_pin_icon"]');
    rows.push({ 序号: rows.length + 1, 时间区间: group, 标题: title, 有置顶图标: pinIcon });
  }

  console.log(`抓到 ${rows.length} 条话题，${new Set(rows.map(r => r.时间区间)).size} 个时间分组`);
  console.table(rows);

  const csv = ['序号,时间区间,标题,有置顶图标']
    .concat(rows.map(r => [r.序号, r.时间区间, `"${r.标题.replace(/"/g, '""')}"`, r.有置顶图标].join(',')))
    .join('\n');
  navigator.clipboard?.writeText(csv).then(
    () => console.log('CSV 已复制'),
    () => console.log('复制失败，请手动选中表格复制')
  );
  console.log('CSV 预览：\n' + csv);
})();