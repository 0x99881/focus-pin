const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFocusWorkbookBuffer, workbookRowsFromState } = require('../src/excel-export');

function unzipStoredEntries(buffer) {
  const entries = {};
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries[name] = buffer.subarray(dataStart, dataStart + size);
    offset = dataStart + size;
  }
  return entries;
}

test('maps app state into the four workbook sheets', () => {
  const rows = workbookRowsFromState({
    items: [
      {
        type: 'todo',
        status: 'active',
        text: '还没完成',
        note: '待办备注',
        createdAt: '2026-06-01T09:00:00+08:00',
        order: 1
      },
      {
        type: 'todo',
        status: 'completed',
        text: '已经完成',
        completionNote: '完成备注',
        createdAt: '2026-06-01T08:00:00+08:00',
        completedAt: '2026-06-01T10:00:00+08:00',
        order: 2
      }
    ],
    slogans: [{ text: '先做眼前这一件', createdAt: '2026-06-01T07:50:00+08:00', order: 1 }],
    trash: [
      {
        type: 'todo',
        text: '删掉的事',
        note: '删除备注',
        createdAt: '2026-06-01T07:00:00+08:00',
        deletedAt: '2026-06-01T11:00:00+08:00'
      }
    ]
  });

  assert.deepEqual(rows['待办'][0], [1, '还没完成', '待安排', '待办备注', '2026-06-01 09:00']);
  assert.deepEqual(rows['历史Check'][0], [1, '已经完成', '完成备注', '2026-06-01 08:00', '2026-06-01 10:00']);
  assert.deepEqual(rows['提醒句'][0], [1, '先做眼前这一件', '2026-06-01 07:50']);
  assert.deepEqual(rows['回收站'][0], [1, '待办', '删掉的事', '删除备注', '2026-06-01 07:00', '', '2026-06-01 11:00']);
});

test('builds an xlsx from real state without example rows', () => {
  const buffer = buildFocusWorkbookBuffer({
    items: [{ type: 'todo', status: 'active', text: '真实待办', createdAt: '2026-06-01T09:00:00+08:00', order: 1 }],
    slogans: [],
    trash: []
  });
  const content = unzipStoredEntries(buffer)['xl/worksheets/sheet4.xml'].toString('utf8');

  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  assert.match(content, /真实待办/);
  assert.doesNotMatch(content, /示例/);
});

test('sanitizes workbook cell text for Excel-compatible xml', () => {
  const unsafeText = `有效文字${String.fromCharCode(0)}<tag>`;
  const hugeText = '长'.repeat(40000);
  const buffer = buildFocusWorkbookBuffer({
    items: [
      { type: 'todo', status: 'active', text: unsafeText, note: hugeText, createdAt: '2026-06-01T09:00:00+08:00', order: 1 }
    ],
    slogans: [],
    trash: []
  });
  const content = unzipStoredEntries(buffer)['xl/worksheets/sheet4.xml'].toString('utf8');

  assert.doesNotMatch(content, /\u0000/);
  assert.match(content, /有效文字&lt;tag&gt;/);
  assert.equal((content.match(/长/g) || []).length, 32767);
});

test('exports the merged Pin task, reminder, history, and recycle-bin data', () => {
  const rows = workbookRowsFromState({
    tasks: [
      { id: 'a', text: '新版未完成', note: '任务备注', status: 'active', day: 'inbox', horizon: 'month', order: 1, createdAt: '2026-09-01T01:00:00.000Z' },
      { id: 'b', text: '新版已完成', completionNote: '完成结果', status: 'completed', order: 2, createdAt: '2026-09-01T02:00:00.000Z', completedAt: '2026-09-01T03:00:00.000Z' }
    ],
    reminders: [{ id: 'r', text: '合并后的提醒', order: 1, createdAt: '2026-09-01T00:00:00.000Z' }],
    trash: [{ id: 't', kind: 'reminder', deletedAt: '2026-09-02T00:00:00.000Z', record: { id: 'rr', text: '删掉的提醒', createdAt: '2026-08-01T00:00:00.000Z' } }]
  });

  assert.equal(rows['待办'][0][1], '新版未完成');
  assert.equal(rows['待办'][0][2], '本月');
  assert.equal(rows['历史Check'][0][1], '新版已完成');
  assert.equal(rows['提醒句'][0][1], '合并后的提醒');
  assert.deepEqual(rows['回收站'][0].slice(1, 3), ['提醒句', '删掉的提醒']);
});

test('exports an English workbook when the app language is English', () => {
  const state = {
    language: 'en',
    tasks: [{ id: 'a', text: 'Outline the chapter', status: 'active', day: 'inbox', horizon: 'month', order: 1, createdAt: '2026-09-01T01:00:00.000Z' }],
    reminders: [{ id: 'r', text: 'One thing at a time', order: 1, createdAt: '2026-09-01T00:00:00.000Z' }],
    trash: []
  };
  const rows = workbookRowsFromState(state);
  const buffer = buildFocusWorkbookBuffer(state);
  const workbook = unzipStoredEntries(buffer)['xl/workbook.xml'].toString('utf8');

  assert.equal(rows.Tasks[0][2], 'This month');
  assert.equal(rows.Reminders[0][1], 'One thing at a time');
  assert.match(workbook, /Completed/);
  assert.match(workbook, /Recycle Bin/);
  assert.match(workbook, /Reminders/);
  assert.match(workbook, /Tasks/);
  assert.doesNotMatch(workbook, /回收站|提醒句|待办/);
});
