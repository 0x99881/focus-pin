# Focus Pin

[中文说明](README.zh-CN.md)

Focus Pin is a local-first desktop workspace for people who lose focus easily, especially people with ADHD-like attention and executive-function difficulties. It turns a vague pile of thoughts into one visible next action without forcing you to build a complicated productivity system.

The core idea is simple: capture first, decide what matters, choose no more than three tasks for today, and focus on one small step at a time.

## Why Focus Pin exists

Many task managers are good at storing information but still leave several hard decisions to the user:

- Where should a sudden thought go?
- Which task is the real main line right now?
- What is the smallest action that can actually be started?
- How can time feel visible instead of abstract?
- How can long-term thinking, today's work, and a focus timer stay connected?

Focus Pin brings those decisions into one calm desktop app. It combines a freeform paper, a main-line map, a small daily checklist, a visual focus timer, and a tiny floating window.

## A practical workflow

1. Write a thought immediately in Quick Capture or double-click the paper to add a note.
2. Use the paper to sketch, write, highlight, and arrange ideas freely.
3. Put active work on the Mission Map and mark each item as a main line, side line, or later item.
4. Choose up to three things for Today.
5. Select one current task and break it into no more than three focus steps.
6. Start a preset or custom countdown. A built-in chime plays when time is up.
7. Mark the task complete and record a short result. You can review or restore it later.

## Main areas

### Today

Today is the landing page and the daily control center. It deliberately limits the list to three items so the page stays readable. One item becomes the current task, while the others wait without competing for attention.

You can:

- add something quickly without deciding where it belongs yet;
- move an item to today or tomorrow;
- choose the current task;
- complete, edit, reorder, or remove an item;
- start focusing directly from the selected task.

### Focus

The Focus page makes time more tangible. Choose a preset duration or enter your own, then work through up to three small steps. You can pause, resume, restart, or finish early. When the countdown reaches zero, Focus Pin uses a short built-in chime instead of an external music file.

### Tiny floating window

Switch to the compact window when you want the app nearby but do not want a full dashboard on screen. It shows only the current action and countdown. Controls stay out of the way until you point at the window. Only this compact mode stays above other windows; normal minimization behaves like an ordinary desktop app.

### Paper

Paper is the loose-thinking space. Drawing works immediately—there is no need to select a pen first. Double-click anywhere to add text. You can also highlight, erase, undo, change the paper background, move notes, and turn a note into a task for today or tomorrow.

Available backgrounds include grid, dots, ruled lines, and blank paper.

### Mission Map

The Mission Map replaces a rigid importance chart with a clearer view of attention:

- Main line: the work that deserves the strongest attention now.
- Side line: useful supporting work that should not replace the main line.
- Later: valid ideas that do not need attention today.

Items can be moved manually. Importance levels remain available as a quick control, while color and visual weight make the difference easier to notice at a glance.

### All Data

All Data is for review and organization rather than daily focus. It keeps unfinished work, tomorrow's items, reminders, completed records, and the recycle bin in one place. You can edit notes, change order, restore deleted items, or export an organized workbook.

## Language support

Focus Pin includes complete Simplified Chinese and English interfaces.

- A fresh installation follows the computer's language: Chinese systems start in Chinese; other systems start in English.
- Use the `EN / 中文` button in the title bar to switch at any time.
- Navigation, buttons, dialogs, dates, status messages, and exported workbook labels all follow the selected language.
- Your own task names, notes, and drawings are never translated or rewritten.

## Privacy and data safety

Focus Pin is designed to work without an account, API, cloud service, analytics, or telemetry.

- Personal tasks and notes stay on the current computer.
- The public project contains no personal task history, reminders, recovery files, or customized example data.
- A fresh installation starts with neutral, empty content.
- Changes are saved automatically.
- The app keeps the previous copy plus rolling recovery snapshots.
- If the main data file is damaged, the app attempts to recover a valid local copy.
- Deleted items first go to the recycle bin and can be restored.

On Windows, runtime data is stored under:

```text
%APPDATA%\desktop-focus-memo
```

That folder is runtime data and is not part of this repository.

## Run locally

Requirements:

- Windows 10 or Windows 11
- Node.js 20 or newer
- npm

```powershell
git clone <your-repository-url>
cd pin
npm install
npm start
```

On Windows, you can also double-click `start-focus-pin.cmd` after dependencies are installed.

## Verify the project

```powershell
npm test
$env:FOCUS_MEMO_SMOKE='1'; npm start
```

The checks cover task and paper data, backups and recovery, workbook export, language switching, window behavior, and the main user flow.

## Project status

Focus Pin is an early local desktop demo built around one-person focus. It currently has no account system, collaboration, cloud synchronization, mobile client, or screenshot sharing. Those omissions are intentional: the current goal is a calm, dependable desktop tool that remains useful without a network connection.

## Development

AI development collaborator: **Codex (OpenAI)**
