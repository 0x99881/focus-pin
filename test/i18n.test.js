'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translateText } = require('../src/i18n');

test('translates core navigation and focus language into English', () => {
  assert.equal(translateText('今日检查', 'en'), 'Today');
  assert.equal(translateText('任务主线图', 'en'), 'Mission Map');
  assert.equal(translateText('本轮步骤', 'en'), 'Steps for this round');
  assert.equal(translateText('专注时长', 'en'), 'Focus length');
  assert.equal(translateText('提醒声音：内置轻提示音（倒计时结束后播放）', 'en'), 'Reminder sound: a gentle built-in chime');
});

test('translates dynamic counts, priorities, and time labels into English', () => {
  assert.equal(translateText('主线 3 · 支线 7', 'en'), 'Main 3 · Side 7');
  assert.equal(translateText('重要度 5/5，重且急，现在就做', 'en'), 'Priority 5/5, Critical, do now');
  assert.equal(translateText('8 件 · 可调整先后', 'en'), '8 items · drag to reorder');
  assert.equal(translateText('开始后约 14:30 结束', 'en'), 'Start to finish around 14:30');
});

test('keeps Chinese text unchanged in the Chinese interface', () => {
  assert.equal(translateText('今日检查', 'zh-CN'), '今日检查');
});
