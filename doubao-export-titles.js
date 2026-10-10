/* 豆包话题列表导出 —— 极简版（145 字符，逐行可读，无任何网络/存储操作）
 *
 * 这段代码做了什么（可逐句核对）：
 *   1. document.querySelectorAll(...)  在当前页面里找所有 class/id 标记为
 *      data-testid="chat_list_thread_item" 的元素 —— 就是侧边栏每一条话题
 *   2. .map(...)                      给每条编号 (i+1)，并取该元素的可见文本第一行（标题）
 *   3. .join('\n')                    用换行拼成一个字符串
 *   4. copy(...)                      Chrome 内置函数，把字符串复制到剪贴板
 *
 * 没有 fetch / XMLHttpRequest / eval / localStorage / cookie —— 不发送任何数据，纯本地读取+复制。
 *
 * 用法：豆包侧边栏展开 → Cmd+Option+I → Console → 粘贴 → 回车
 *粘贴前需先输入 allow pasting 回车（Chrome 自我保护机制，见 README 说明）
 */
copy([...document.querySelectorAll('[data-testid="chat_list_thread_item"]')].map((e,i)=>(i+1)+'. '+e.innerText.trim().split('\n')[0]).join('\n'))