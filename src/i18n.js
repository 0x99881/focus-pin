(function attachFocusI18n(globalScope) {
  'use strict';

  const EN = {
    '专注钉': 'Focus Pin',
    '主要页面': 'Main pages',
    '今日检查': 'Today',
    '专注时间': 'Focus',
    '纸面': 'Paper',
    '任务主线': 'Mission Map',
    '全部数据': 'All Data',
    '已保存': 'Saved',
    '保存中…': 'Saving…',
    '本地空间不足': 'Not enough local storage',
    '保存失败，已留临时副本': 'Save failed; a temporary copy is safe',
    '已从备份恢复': 'Recovered from backup',
    '旧版数据已合并': 'Previous data merged',
    '切换明暗': 'Switch light or dark theme',
    '切换到英文': 'Switch to English',
    '变成桌面小窗': 'Open floating window',
    '小窗': 'Float',
    '最小化': 'Minimize',
    '关闭': 'Close',
    '展开': 'Expand',
    '修改给自己的提醒': 'Edit your visible reminder',
    '提醒自己': 'Reminder',
    '写一句只对你有用的话': 'Write one sentence you need to see',
    '点击修改': 'Click to edit',
    '主题电子纸': 'Focus papers',
    '新建主题纸': 'New focus paper',
    '回收站': 'Recycle Bin',
    '随手记（Ctrl + Shift + Space）': 'Quick capture (Ctrl + Shift + Space)',
    '随手记': 'Quick capture',
    '专注': 'Focus',
    '眼前一步': 'Next action',
    '先从今日检查里选一件': 'Choose one task from Today',
    '准备开始': 'Ready',
    '开始后显示结束时间': 'End time appears after starting',
    '开始': 'Start',
    '停音乐': 'Stop sound',
    '完成': 'Complete',
    '本周': 'This week',
    '7 天内': 'Within 7 days',
    '本月': 'This month',
    '30 天内': 'Within 30 days',
    '半年': 'Six months',
    '6 个月内': 'Within 6 months',
    '待安排': 'Someday',
    '还没决定': 'No date yet',
    '本轮已经结束': 'This focus round is complete',
    '预计': 'Ends around',
    '继续后约': 'Resume to finish around',
    '开始后约': 'Start to finish around',
    '结束': '',
    '有手写痕迹': 'Has handwriting',
    '移到回收站': 'Move to Recycle Bin',
    '删除主题纸': 'Delete focus paper',
    '向上': 'Move up',
    '向下': 'Move down',
    '没有主题纸': 'No focus papers yet',
    '主题纸标题': 'Focus paper title',
    '随手写，内容会自动保存': 'Write freely. Everything saves automatically.',
    '电子纸工具': 'Paper tools',
    '画笔': 'Pen',
    '荧光笔': 'Highlighter',
    '橡皮': 'Eraser',
    '笔迹颜色和粗细': 'Ink color and width',
    '自动': 'Auto',
    '橙色': 'Orange',
    '蓝色': 'Blue',
    '黄色': 'Yellow',
    '细': 'Thin',
    '中': 'Medium',
    '粗': 'Thick',
    '撤销笔迹': 'Undo stroke',
    '撤销': 'Undo',
    '清空笔迹': 'Clear strokes',
    '清空': 'Clear',
    '纸张样式': 'Paper style',
    '格子纸': 'Grid paper',
    '点阵纸': 'Dot paper',
    '横线纸': 'Lined paper',
    '空白纸': 'Blank paper',
    '格': 'Grid',
    '点': 'Dots',
    '线': 'Lines',
    '空': 'Blank',
    '按住空白处直接画 · 双击添加文字': 'Draw anywhere · Double-click to add text',
    '文字和纸片仍可直接点选、修改和移动': 'Select, edit, and move text cards directly',
    '整张电子纸画布': 'Full paper canvas',
    '文字纸片': 'Text card',
    '按住移动这张纸片': 'Drag to move this card',
    '纸片': 'Card',
    '换纸张颜色': 'Change card color',
    '删除纸片': 'Delete card',
    '从这里开始写…': 'Start writing here…',
    '放到': 'Send to',
    '今天': 'Today',
    '按住移动这段文字': 'Drag to move this text block',
    '方向名称': 'Section name',
    '公司或目标：': 'Goal:',
    '点这里写': 'Click to write',
    '随手想法：': 'Rough thoughts:',
    '先写几句，粗糙也没关系…': 'Write a rough thought. It does not need to be polished…',
    '下一步：': 'Next action:',
    '写一件可以马上做的小事': 'Write one small action you can start now',
    '把下一步放入待办': 'Send next action to tasks',
    '下一步放到': 'Send next action to',
    '有空再做': 'Optional',
    '可以等等': 'Can wait',
    '正常推进': 'Keep moving',
    '重要，接下来做': 'Important, do next',
    '重且急，现在就做': 'Critical, do now',
    '当前主线': 'Current main task',
    '支线': 'Side task',
    '同重要度内拖动排序': 'Drag to reorder tasks with the same priority',
    '拖动调整同分顺序': 'Drag to reorder tasks with the same score',
    '继续': 'Continue',
    '修改': 'Edit',
    '方向比忙碌更重要': 'Direction beats busyness',
    '任务主线图': 'Mission Map',
    '全部未完成事项任务主线图': 'Mission map for all active tasks',
    '主线只留三件：当前任务在第一站': 'Keep only three main tasks. The current task stays first.',
    '调高档位会向主线靠近；同档时抓住把手拖动。': 'Raise priority to move a task toward the main line. Drag to reorder equal priorities.',
    '五档重要度颜色': 'Five priority colors',
    '轻': 'Light',
    '重 / 急': 'Heavy / urgent',
    '还没有未完成事项。': 'No active tasks yet.',
    '主线任务': 'Main tasks',
    '主线': 'Main',
    '现在推进': 'Move now',
    '当前 → 接下来 → 再下一步': 'Now → Next → Later',
    '支线任务': 'Side tasks',
    '先放在旁边': 'Keep nearby',
    '不会丢，需要时调高档位': 'Nothing is lost. Raise its priority when needed.',
    '继续专注': 'Continue focus',
    '开始专注': 'Start focus',
    '✓ 完成': '✓ Complete',
    '放回本周': 'Move to This week',
    '从本周挑一件': 'Choose one from This week',
    '今天只装真正要完成的事': 'Keep Today for real commitments',
    '全部未完成': 'All active tasks',
    '导出整理表': 'Export workbook',
    '快速收集': 'Quick capture',
    '写下一件事，回车放进待安排': 'Write one thing and press Enter to save it for later',
    '加入待安排': 'Add to Someday',
    '还没有未完成的事。': 'No active tasks yet.',
    '提醒句': 'Reminders',
    '添加': 'Add',
    '旧版的提醒句和新写的提醒都会在这里。': 'Your reminders will appear here.',
    '完成记录': 'Completed',
    '恢复': 'Restore',
    '完成的事情会留在这里。': 'Completed tasks will stay here.',
    '每日收口': 'Daily reset',
    '今天要完成': 'What matters today',
    '今天已完成': 'Completed today',
    '今天的三件事': 'Today’s three tasks',
    '写下一件具体的小事': 'Write one specific next action',
    '放到今天': 'Add to Today',
    '放到本周': 'Add to This week',
    '时间视野': 'Time horizon',
    '接下来往哪走': 'What comes next',
    '重要度决定先后，周期决定什么时候完成': 'Priority decides order. Horizon decides when.',
    '完成周期': 'Time horizon',
    '所有事情都已经有时间方向了。': 'Every task already has a time horizon.',
    '今天完成': 'Completed today',
    '本轮完成': 'Round complete',
    '专注中': 'Focusing',
    '已暂停': 'Paused',
    '今天还没有当前任务': 'No current task yet',
    '回到今日检查，先选一件。': 'Return to Today and choose one task.',
    '本轮步骤': 'Steps for this round',
    '支线先记下，不切走': 'Capture side thoughts without switching away',
    '先选择一条主线': 'Choose a main task first',
    '三步已满，完成或删除后再加': 'Three steps are full. Complete or remove one first.',
    '例如：先整理资料目录': 'Example: organize the source folder',
    '记下': 'Capture',
    '删除这一步': 'Delete this step',
    '把这一轮要做的小步骤写在这里。': 'Write the small steps for this focus round here.',
    '专注时长': 'Focus length',
    '提醒声音：内置轻提示音（倒计时结束后播放）': 'Reminder sound: a gentle built-in chime',
    '自定义': 'Custom',
    '自定义专注分钟数': 'Custom focus minutes',
    '分钟': 'min',
    '使用': 'Apply',
    '这一轮结束了，接下来？': 'This round is done. What next?',
    '可以继续一轮，或完成整条主线。': 'Start another round or complete the whole main task.',
    '✓ 完成本轮步骤': '✓ Complete this step',
    '完成整条主线': 'Complete main task',
    '再专注一轮': 'Start another round',
    '停止音乐': 'Stop sound',
    '暂停': 'Pause',
    '重新计时': 'Reset timer',
    '切换任务：': 'Switch task:',
    '重来': 'Restart',
    '修改待办': 'Edit task',
    '把事情写清楚一点': 'Make the task clear',
    '事情': 'Task',
    '备注': 'Notes',
    '补充背景、标准或想法…': 'Add context, a finish line, or notes…',
    '重要度': 'Priority',
    '重要度改变后，会自动按高到低归位。': 'Changing priority moves the task into the right group.',
    '取消': 'Cancel',
    '保存': 'Save',
    '新建主题电子纸': 'New focus paper',
    '这张纸要用来想什么？': 'What will this paper help you think through?',
    '先写一个简单名字，之后随时可以在纸面上修改。': 'Give it a simple name. You can change it later.',
    '主题名字': 'Paper name',
    '新主题': 'New focus',
    '创建纸面': 'Create paper',
    '留一句现在最需要看到的话': 'Write the sentence you most need to see',
    '它会一直放在页面上方，想换的时候再点一下。': 'It stays visible at the top until you change it.',
    '给自己的提醒': 'Reminder to yourself',
    '例如：一次只做一件事': 'Example: one thing at a time',
    '保存提醒': 'Save reminder',
    '先接住，不用现在决定': 'Capture it now. Decide later.',
    '想到什么就写什么': 'Write whatever just came to mind',
    '自动放入“待安排”': 'Saved automatically to Someday',
    '记下来': 'Save it',
    '留下完成痕迹': 'Record the finish',
    '简单写一句结果。它会回到原来的主题纸，也会留在完成记录里。': 'Write one short result. It will stay on its original paper and in Completed.',
    '例如：整理完资料，并标出了下一步。': 'Example: organized the material and marked the next action.',
    '还没完成': 'Not finished',
    '确认完成': 'Confirm complete',
    '可恢复': 'Recoverable',
    '删除的主题纸和任务都先放在这里，不会立刻消失。': 'Deleted papers and tasks stay here until you restore them.',
    '任务': 'Task',
    '回收站是空的。': 'Recycle Bin is empty.',
    '启动时遇到问题。你的本地副本仍然保留着，请重新打开应用。': 'The app could not start. Your local copy is still safe; please reopen it.',
    '启动失败': 'Startup failed'
    ,'先从今天的三件里选一件': 'Choose one of today’s three tasks first'
    ,'先暂停计时，再修改时长': 'Pause the timer before changing its length'
    ,'先写下一个具体的“下一小步”': 'Write one concrete next action first'
    ,'已钉到今天': 'Added to Today'
    ,'已放到本周': 'Moved to This week'
    ,'今天已经有三件了。先完成一件，或放到本周。': 'Today already has three tasks. Complete one or move it to This week.'
    ,'先在纸片里写下一件具体的事': 'Write one concrete action on the card first'
    ,'纸片已钉到今天': 'Card added to Today'
    ,'纸片已放到本周': 'Card moved to This week'
    ,'已放到今天': 'Moved to Today'
    ,'已加入待安排': 'Added to Someday'
    ,'页面上方提醒已更新': 'Top reminder updated'
    ,'已记下，放在待安排': 'Captured and saved to Someday'
    ,'整理表已经打开': 'Workbook opened'
    ,'整理表已保存到项目文件夹': 'Workbook saved in the project folder'
    ,'整理表没有打开，请稍后再试': 'The workbook did not open. Please try again.'
    ,'整理表导出失败，数据本身不受影响': 'Workbook export failed. Your data is safe.'
    ,'文字位置已保存': 'Text position saved'
    ,'纸片位置已保存': 'Card position saved'
    ,'把这张主题纸移到回收站？之后可以恢复。': 'Move this focus paper to the Recycle Bin? You can restore it later.'
    ,'至少保留一张主题纸': 'Keep at least one focus paper'
    ,'现在没有可撤销的笔迹': 'There are no strokes to undo'
    ,'画板现在是空的': 'The canvas is already empty'
    ,'清空这张画板上的笔迹？清空后仍可以点一次撤销。': 'Clear every stroke on this canvas? You can undo once afterward.'
    ,'画板已清空，点撤销可以找回': 'Canvas cleared. Use Undo to restore it.'
    ,'删除这张文字纸片？': 'Delete this text card?'
    ,'已设为专注任务': 'Set as the focus task'
    ,'支线已记下，继续当前主线': 'Side step captured. Stay on the current main task.'
    ,'本轮最多放三步，先完成或删除一步': 'This round holds up to three steps. Complete or remove one first.'
    ,'删除这条本轮步骤？': 'Delete this focus step?'
    ,'还没有需要完成的本轮步骤': 'There is no unfinished step in this round'
    ,'本轮步骤已完成': 'Focus step completed'
    ,'今天已经有三件了': 'Today already has three tasks'
    ,'修改已经保存': 'Changes saved'
    ,'先给这张纸写一个名字': 'Give this paper a name first'
    ,'新主题纸已经建好': 'New focus paper created'
    ,'把这件事移到回收站？之后可以恢复。': 'Move this task to the Recycle Bin? You can restore it later.'
    ,'完成痕迹已经收好': 'Completion recorded'
    ,'已经恢复': 'Restored'
    ,'已恢复到待安排': 'Restored to Someday'
    ,'提醒句已经收好': 'Reminder saved'
    ,'修改提醒句': 'Edit reminder'
    ,'把这条提醒放进回收站？': 'Move this reminder to the Recycle Bin?'
    ,'音乐已停止': 'Reminder sound stopped'
    ,'不同重要度不用拖，直接点右边的数字调整': 'Use the number buttons to change priority. Drag only within the same level.'
    ,'同重要度顺序已调整': 'Order updated within this priority level'
    ,'旧版待办、提醒和记录已经合并': 'Previous tasks, reminders, and records were merged'
  };

  const PATTERNS = [
    [/^(\d+) 件在推进$/, '$1 active'],
    [/^主线第 (\d+) 站$/, 'Main step $1'],
    [/^主线 (\d+) · 支线 (\d+)$/, 'Main $1 · Side $2'],
    [/^重要度 (\d+)$/, 'Priority $1'],
    [/^(\d+) 档$/, 'Level $1'],
    [/^设为重要度 (\d+)$/, 'Set priority to $1'],
    [/^重要度 (\d+)：(.+)$/, 'Priority $1: $2'],
    [/^重要度 (\d+)\/5，(.+)$/, 'Priority $1/5, $2'],
    [/^重要度 (\d+)\/5$/, 'Priority $1/5'],
    [/^主线第 (\d+) 站 · 重要度 (\d+)\/5 · (.+)$/, 'Main step $1 · Priority $2/5 · $3'],
    [/^当前主线 · 重要度 (\d+)\/5 · (.+)$/, 'Current main task · Priority $1/5 · $2'],
    [/^支线 · 重要度 (\d+)\/5 · (.+)$/, 'Side task · Priority $1/5 · $2'],
    [/^(.+)的重要度$/, 'Priority for $1'],
    [/^(.+)的完成周期$/, 'Time horizon for $1'],
    [/^(.+)文字块$/, '$1 text block'],
    [/^(\d+) \/ 5 · (.+)$/, '$1 / 5 · $2'],
    [/^(主题纸|提醒句|任务) · (.+)$/, (_, type, detail) => `${EN[type]} · ${detail}`],
    [/^(继续专注|开始专注) · (\d+) 分钟$/, (_, action, minutes) => `${EN[action]} · ${minutes} min`],
    [/^(\d+) 件 · 可调整先后$/, '$1 items · drag to reorder'],
    [/^(\d+) 件$/, '$1 items'],
    [/^(\d+) 条$/, '$1 reminders'],
    [/^今天完成 (\d+) 件$/, '$1 completed today'],
    [/^这里还没有事情，可以从“待安排”移进来。$/, 'Nothing here yet. Move something in from Someday.'],
    [/^眼前一步：(.+)$/, 'Next action: $1'],
    [/^请输入 (\d+) 到 (\d+) 分钟$/, 'Enter a value from $1 to $2 minutes'],
    [/^本轮专注时间已设为 (\d+) 分钟$/, 'Focus length set to $1 minutes'],
    [/^重要度已设为 (\d+)\/5，排序已经更新$/, 'Priority set to $1/5. Order updated.'],
    [/^已放到(.+)$/, 'Moved to $1'],
    [/^预计 (.+) 结束$/, 'Ends around $1'],
    [/^继续后约 (.+) 结束$/, 'Resume to finish around $1'],
    [/^开始后约 (.+) 结束$/, 'Start to finish around $1']
  ];

  const USER_CONTENT_SELECTOR = [
    '#sidebarReminder', '#compactTask', '.paper-select strong', '.lane-result', '.paper-free-note textarea',
    '.mission-task-copy h3', '.today-commitment h2', '.today-commitment > p', '.horizon-task-copy strong', '.horizon-task-copy small',
    '.organize-task-copy strong', '.organize-task-copy small', '.reminder-row p', '.organize-history-row strong', '.organize-history-row small',
    '.today-completed-list strong', '.today-completed-list small', '.focus-card > h1', '.focus-source',
    '.focus-step-row strong', '.trash-row strong'
  ].join(',');

  const textSources = new WeakMap();
  const attributeSources = new WeakMap();

  function translateText(value, language = 'zh-CN') {
    const source = String(value ?? '');
    if (language !== 'en' || !/[\u3400-\u9fff]/u.test(source)) return source;
    const match = source.match(/^(\s*)(.*?)(\s*)$/s);
    const leading = match?.[1] || '';
    const core = match?.[2] || source;
    const trailing = match?.[3] || '';
    if (Object.hasOwn(EN, core)) return `${leading}${EN[core]}${trailing}`;
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(core)) {
        let translated = core.replace(pattern, replacement);
        ['有空再做', '可以等等', '正常推进', '重要，接下来做', '重且急，现在就做', '本周', '本月', '半年', '待安排']
          .forEach((phrase) => { translated = translated.replaceAll(phrase, EN[phrase]); });
        return `${leading}${translated}${trailing}`;
      }
    }
    let translated = core;
    ['有空再做', '可以等等', '正常推进', '重要，接下来做', '重且急，现在就做']
      .forEach((phrase) => { translated = translated.replaceAll(phrase, EN[phrase]); });
    if (translated !== core) return `${leading}${translated}${trailing}`;
    return source;
  }

  function shouldSkipText(node) {
    const parent = node.parentElement;
    return !parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName) || Boolean(parent.closest(USER_CONTENT_SELECTOR));
  }

  function apply(root, language = 'zh-CN') {
    const safeLanguage = language === 'en' ? 'en' : 'zh-CN';
    const documentNode = root.nodeType === 9 ? root : root.ownerDocument;
    if (!documentNode) return;
    documentNode.documentElement.lang = safeLanguage;
    documentNode.title = safeLanguage === 'en' ? 'Focus Pin' : '专注钉';
    const walker = documentNode.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (shouldSkipText(node)) return;
      if (!textSources.has(node)) textSources.set(node, node.nodeValue || '');
      const source = textSources.get(node);
      node.nodeValue = safeLanguage === 'en' ? translateText(source, 'en') : source;
    });

    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll('*')].filter((node) => node?.getAttribute) : [];
    elements.forEach((element) => {
      if (element.id === 'languageButton') return;
      if (element.matches?.(USER_CONTENT_SELECTOR)) return;
      const sources = attributeSources.get(element) || {};
      ['title', 'aria-label', 'placeholder'].forEach((name) => {
        if (!element.hasAttribute(name)) return;
        if (!Object.hasOwn(sources, name)) sources[name] = element.getAttribute(name) || '';
        element.setAttribute(name, safeLanguage === 'en' ? translateText(sources[name], 'en') : sources[name]);
      });
      attributeSources.set(element, sources);
    });
  }

  const api = { translateText, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.focusI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
