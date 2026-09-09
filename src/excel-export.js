const SHEETS_ZH = [
  {
    name: '历史Check',
    columns: ['编号', '事件', '备注', '创建时间', '完成时间'],
    widths: [8, 28, 36, 20, 20]
  },
  {
    name: '回收站',
    columns: ['编号', '类型', '内容', '备注', '创建时间', '完成时间', '删除时间'],
    widths: [8, 12, 32, 36, 20, 20, 20]
  },
  {
    name: '提醒句',
    columns: ['编号', '提醒句', '创建时间'],
    widths: [8, 48, 20]
  },
  {
    name: '待办',
    columns: ['编号', '待办事项', '完成周期', '备注', '创建时间'],
    widths: [8, 34, 14, 40, 20]
  }
];

const SHEETS_EN = [
  { name: 'Completed', columns: ['No.', 'Task', 'Result', 'Created', 'Completed'], widths: [8, 28, 36, 20, 20] },
  { name: 'Recycle Bin', columns: ['No.', 'Type', 'Content', 'Notes', 'Created', 'Completed', 'Deleted'], widths: [8, 12, 32, 36, 20, 20, 20] },
  { name: 'Reminders', columns: ['No.', 'Reminder', 'Created'], widths: [8, 48, 20] },
  { name: 'Tasks', columns: ['No.', 'Task', 'Horizon', 'Notes', 'Created'], widths: [8, 34, 14, 40, 20] }
];

const TYPE_LABELS_ZH = {
  todo: '待办',
  slogan: '提醒句'
};

const TYPE_LABELS_EN = { todo: 'Task', slogan: 'Reminder' };

const MAX_EXCEL_CELL_TEXT_LENGTH = 32767;
const MAX_ZIP_FILE_COUNT = 0xffff;
const MAX_ZIP_FIELD_SIZE = 0xffff;
const MAX_ZIP_ENTRY_SIZE = 0xffffffff;
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function sanitizeXmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, MAX_EXCEL_CELL_TEXT_LENGTH);
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function activeTodos(state) {
  const records = Array.isArray(state.tasks) ? state.tasks : asArray(state.items);
  return records
    .filter((item) => (item?.type === 'todo' || Array.isArray(state.tasks)) && item.status === 'active')
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function completedTodos(state) {
  const records = Array.isArray(state.tasks) ? state.tasks : asArray(state.items);
  return records
    .filter((item) => (item?.type === 'todo' || Array.isArray(state.tasks)) && item.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
}

function activeSlogans(state) {
  const records = Array.isArray(state.reminders) ? state.reminders : asArray(state.slogans);
  return records.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function trashRecords(state) {
  return asArray(state.trash)
    .map((entry) => {
      if (!entry?.record) return entry;
      return {
        ...entry.record,
        type: entry.kind === 'reminder' ? 'slogan' : entry.kind === 'task' ? 'todo' : entry.kind,
        deletedAt: entry.deletedAt
      };
    })
    .sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
}

function scheduleLabel(item) {
  const english = item?.language === 'en';
  if (item?.day === 'today') return english ? 'Today' : '今天';
  const labels = english
    ? { week: 'This week', month: 'This month', 'half-year': 'Six months', unscheduled: 'Someday' }
    : { week: '本周', month: '本月', 'half-year': '半年', unscheduled: '待安排' };
  return labels[item?.horizon] || (item?.day === 'tomorrow' ? labels.week : labels.unscheduled);
}

function workbookRowsFromState(state) {
  const english = state?.language === 'en';
  const names = english
    ? { completed: 'Completed', trash: 'Recycle Bin', reminders: 'Reminders', tasks: 'Tasks' }
    : { completed: '历史Check', trash: '回收站', reminders: '提醒句', tasks: '待办' };
  const typeLabels = english ? TYPE_LABELS_EN : TYPE_LABELS_ZH;
  return {
    [names.completed]: completedTodos(state).map((item, index) => [
      index + 1,
      cleanText(item.text),
      cleanText(item.completionNote),
      formatTime(item.createdAt),
      formatTime(item.completedAt)
    ]),
    [names.trash]: trashRecords(state).map((item, index) => [
      index + 1,
      typeLabels[item.type] || cleanText(item.type),
      cleanText(item.text),
      cleanText(item.completionNote || item.note),
      formatTime(item.createdAt),
      formatTime(item.completedAt),
      formatTime(item.deletedAt)
    ]),
    [names.reminders]: activeSlogans(state).map((item, index) => [
      index + 1,
      cleanText(item.text),
      formatTime(item.createdAt)
    ]),
    [names.tasks]: activeTodos(state).map((item, index) => [
      index + 1,
      cleanText(item.text),
      scheduleLabel({ ...item, language: english ? 'en' : 'zh-CN' }),
      cleanText(item.note),
      formatTime(item.createdAt)
    ])
  };
}

function xmlEscape(value) {
  return sanitizeXmlText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid Excel column index: ${index}`);
  }
  let dividend = index + 1;
  let name = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return name;
}

function inlineCell(rowIndex, columnIndex, value, style = 0) {
  const cellRef = `${columnName(columnIndex)}${rowIndex}`;
  const styleAttr = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${cellRef}"${styleAttr}><v>${value}</v></c>`;
  }
  return `<c r="${cellRef}" t="inlineStr"${styleAttr}><is><t>${xmlEscape(value)}</t></is></c>`;
}

function worksheetXml(sheet, rows) {
  const allRows = [sheet.columns, ...rows];
  const lastColumn = columnName(sheet.columns.length - 1);
  const lastRow = Math.max(1, allRows.length);
  const cols = sheet.widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('');
  const sheetData = allRows
    .map((row, rowIndex) => {
      const excelRow = rowIndex + 1;
      const cells = row.map((value, columnIndex) => inlineCell(excelRow, columnIndex, value, rowIndex === 0 ? 1 : 0)).join('');
      return `<row r="${excelRow}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
}

function workbookXml(sheetDefinitions) {
  const sheets = sheetDefinitions.map(
    (sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetDefinitions) {
  const sheetRels = sheetDefinitions.map(
    (_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheetDefinitions.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheetDefinitions) {
  const sheets = sheetDefinitions.map(
    (_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

function writeZip(files) {
  if (files.length > MAX_ZIP_FILE_COUNT) {
    throw new Error(`Too many files for a standard xlsx archive: ${files.length}`);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    if (name.length > MAX_ZIP_FIELD_SIZE) {
      throw new Error(`Xlsx entry name is too long: ${file.name}`);
    }
    if (data.length > MAX_ZIP_ENTRY_SIZE || offset > MAX_ZIP_ENTRY_SIZE) {
      throw new Error(`Xlsx entry is too large: ${file.name}`);
    }
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildFocusWorkbookBuffer(state) {
  const rowsBySheet = workbookRowsFromState(state || {});
  const sheetDefinitions = state?.language === 'en' ? SHEETS_EN : SHEETS_ZH;
  const files = [
    { name: '[Content_Types].xml', data: contentTypesXml(sheetDefinitions) },
    { name: '_rels/.rels', data: rootRelsXml() },
    { name: 'xl/workbook.xml', data: workbookXml(sheetDefinitions) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml(sheetDefinitions) },
    { name: 'xl/styles.xml', data: stylesXml() },
    ...sheetDefinitions.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: worksheetXml(sheet, rowsBySheet[sheet.name] || [])
    }))
  ];
  return writeZip(files);
}

module.exports = {
  buildFocusWorkbookBuffer,
  workbookRowsFromState
};
