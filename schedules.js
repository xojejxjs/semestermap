// schedules.js：多份课表（比如自己的课表和 Plan B，或者室友的课表）
//
// 做法：myClasses.items 永远只放"当前这一份"课表的课，其他几份存在 myClasses.schedules 里
// 切换时两边交换一下。列表、地图、课间步行、Directions 读的都是 myClasses.items，
// 所以它们不用改，自动"只看当前这一份"
//
// 只有一份课表时，切换栏完全不显示：大多数人根本看不到这个功能，界面保持简单

// 新课表的默认名字：Schedule 2、Schedule 3……（跳过已经用过的名字）
function nextScheduleName() {
  const names = myClasses.schedules.map(function (schedule) { return schedule.name; });
  let n = 2;
  while (names.includes('Schedule ' + n)) {
    n++;
  }
  return 'Schedule ' + n;
}

// 切换课表、新建、删除以后：收起展开的东西、清掉撤销（不然 Undo 会把上一份课表的课放进这一份）
function resetScheduleView() {
  myClasses.openId = null;
  myClasses.expandedId = null;
  myClasses.mapPlaceId = null;
  myClasses.selecting = false;
  myClasses.selected = new Set();
  myClasses.undo = null;
  myClasses.scheduleMenuOpen = false;
  document.getElementById('class-toast').hidden = true;
  clearClassPreview();
  selectClassPlace(null);
}

// 换到另一份课表
// 输入：课表的 id
function switchSchedule(id) {
  const target = myClasses.schedules.find(function (schedule) { return schedule.id === id; });
  if (!target || id === myClasses.activeId) {
    return;
  }
  syncActiveSchedule(); // 先把当前这一份的课存回去
  myClasses.activeId = id;
  myClasses.items = target.items;
  resetScheduleView();
  renderMyClasses();
}

// 新建一份空的课表，并换过去（"添加课表"会自动展开，可以直接导入）
// 输入：名字
// 输出：新的课表
// kind：'friend' 表示这是朋友的课表（Shared classes 默认选它，见 compare.js）；自己的方案不写
function createSchedule(name, kind) {
  syncActiveSchedule();
  const schedule = { id: newScheduleId(), name: name, items: [] };
  if (kind) {
    schedule.kind = kind;
  }
  myClasses.schedules.push(schedule);
  myClasses.activeId = schedule.id;
  myClasses.items = schedule.items;
  resetScheduleView();
  renderMyClasses();
  return schedule;
}

// 新课表的 id：比现在最大的大 1
function newScheduleId() {
  return Math.max.apply(null, myClasses.schedules.map(function (schedule) { return schedule.id; })) + 1;
}

// 把批量选中的课移到另一份课表（比如导入时选错了，或者想把一部分课拆出去）
// 输入：另一份课表的 id，或者 'new'（新建一份，名字是 Schedule N）
// 目标课表里已经有同一个时段的课，就不重复放；8 秒内可以 Undo
function moveSelectedTo(value) {
  const ids = myClasses.selected;
  if (ids.size === 0) {
    return;
  }
  syncActiveSchedule();
  let target = myClasses.schedules.find(function (schedule) { return schedule.id === Number(value); });
  const created = value === 'new' || !target;
  if (created) {
    target = { id: newScheduleId(), name: nextScheduleName(), items: [] };
    myClasses.schedules.push(target);
  }

  // 记下移动之前两边的样子，Undo 时放回去
  const sourceBefore = myClasses.items.slice();
  const targetBefore = target.items.slice();

  const moving = myClasses.items.filter(function (c) { return ids.has(c.id); });
  myClasses.items = myClasses.items.filter(function (c) { return !ids.has(c.id); });
  moving.forEach(function (c) {
    if (!target.items.some(function (other) { return sameMeeting(other, c); })) {
      target.items.push(c);
    }
  });

  myClasses.selecting = false;
  myClasses.selected = new Set();
  myClasses.openId = null;
  myClasses.expandedId = null;
  myClasses.undo = function () {
    myClasses.items = sourceBefore;
    target.items = targetBefore;
    if (created) {
      myClasses.schedules = myClasses.schedules.filter(function (schedule) { return schedule !== target; });
    }
  };
  renderMyClasses();
  showToast(`Moved ${moving.length} ${moving.length === 1 ? 'class' : 'classes'} to "${target.name}"`);
}

// ===== 找和朋友相同的课：点两下就能开始 =====
// 1. 点 "Find classes you share" → 新建一份叫 Friend 的课表（标成朋友），打开选文件的窗口
// 2. 选了朋友的课表文件、读完以后 → 换回自己的课表，打开 Shared classes，显示"我和 Friend"

// 朋友课表的默认名字：Friend、Friend 2……（用户之后可以改成朋友的名字）
function nextFriendName() {
  const names = myClasses.schedules.map(function (schedule) { return schedule.name; });
  let name = 'Friend';
  let n = 2;
  while (names.includes(name)) {
    name = 'Friend ' + n;
    n++;
  }
  return name;
}

function startFindShared() {
  const base = myClasses.activeId;
  const friend = createSchedule(nextFriendName(), 'friend');
  myClasses.pendingShared = { base: base, friend: friend.id };
  document.getElementById('schedule-file').click();
}

// 读完文件以后调用（my-classes.js 的 handleScheduleFiles）
function finishFindShared() {
  const pending = myClasses.pendingShared;
  if (!pending || myClasses.activeId !== pending.friend) {
    return;
  }
  myClasses.pendingShared = null;
  if (myClasses.items.length === 0) {
    return; // 没读出课：留在朋友的课表里，用户可以再试一次
  }
  // 面板已经开着并且选了人：保留原来选的人，再加上新朋友；否则只选新朋友
  const kept = (myClasses.toolOpen === 'shared' && myClasses.sharedWith) ? myClasses.sharedWith : new Set();
  switchSchedule(pending.base);
  myClasses.toolOpen = 'shared';
  myClasses.sharedBase = pending.base;
  myClasses.sharedWith = new Set(Array.from(kept).concat([pending.friend]));
  renderMyClasses();
  document.getElementById('schedule-compare').scrollIntoView({ block: 'nearest' });
}

function cancelFindShared() {
  const pending = myClasses.pendingShared;
  if (!pending || myClasses.activeId !== pending.friend || myClasses.items.length > 0) {
    return;
  }
  myClasses.pendingShared = null;
  // 不显示"已删除"的提示：用户只是取消了，没有删东西
  syncActiveSchedule();
  myClasses.schedules = myClasses.schedules.filter(function (schedule) { return schedule.id !== pending.friend; });
  myClasses.activeId = pending.base;
  myClasses.items = activeSchedule().items;
  resetScheduleView();
  renderMyClasses();
}

// 改名：空的名字不接受，太长的截掉
function renameSchedule(id, name) {
  const schedule = myClasses.schedules.find(function (s) { return s.id === id; });
  const clean = name.trim().slice(0, 40);
  if (schedule && clean) {
    schedule.name = clean;
  }
  myClasses.scheduleMenuOpen = false;
  renderMyClasses();
}

// 删掉一份课表（至少留一份）；8 秒内可以 Undo
function deleteSchedule(id) {
  const schedules = myClasses.schedules;
  const index = schedules.findIndex(function (s) { return s.id === id; });
  if (index === -1 || schedules.length <= 1) {
    return;
  }
  syncActiveSchedule();
  const removed = schedules[index];
  const wasActive = id === myClasses.activeId;
  schedules.splice(index, 1);
  if (wasActive) {
    // 删的是正在看的那一份：换到它前面一份（没有就是后面一份）
    const next = schedules[Math.max(0, index - 1)];
    myClasses.activeId = next.id;
    myClasses.items = next.items;
  }
  resetScheduleView();

  // 撤销：放回原来的位置；删之前正在看它的话，也换回去
  myClasses.undo = function () {
    syncActiveSchedule();
    schedules.splice(index, 0, removed);
    if (wasActive) {
      myClasses.activeId = removed.id;
      myClasses.items = removed.items;
    }
  };
  renderMyClasses();
  showToast(`Deleted "${removed.name}"`);
}

// ===== 显示 =====

// My week 最上面的切换栏：[My schedule ▾] [Plan B] + New
// renderMyClasses() 每次都会调用它
function renderScheduleSwitcher() {
  const box = document.getElementById('schedule-switcher');

  // "添加课表"里的"另开一份课表""找和朋友相同的课"：当前这一份已经有课时才显示（还是空的，直接往里加就好）
  document.getElementById('new-schedule-row').hidden = myClasses.items.length === 0;
  document.getElementById('friend-row').hidden = myClasses.items.length === 0;

  if (myClasses.schedules.length <= 1) {
    box.innerHTML = '';
    return;
  }

  let html = '<div class="schedule-chips">';
  myClasses.schedules.forEach(function (schedule) {
    const name = escapeHtml(schedule.name);
    if (schedule.id === myClasses.activeId) {
      // 当前这一份：点一下展开"改名 / 删除"
      html += `<button type="button" class="schedule-chip" aria-pressed="true" data-action="schedule-menu"
        aria-expanded="${Boolean(myClasses.scheduleMenuOpen)}">${name} ▾</button>`;
    } else {
      html += `<button type="button" class="schedule-chip" aria-pressed="false" data-action="switch-schedule"
        data-schedule="${schedule.id}">${name}</button>`;
    }
  });
  html += '<button type="button" class="schedule-chip schedule-new" data-action="new-schedule">+ New</button></div>';
  // 两个工具（compare.js），一次只开一个：比较自己的几个方案 / 找和别人相同的课
  const tool = myClasses.toolOpen;
  html += `<div class="schedule-tools">
    <button type="button" class="tool-button" data-action="toggle-compare" aria-expanded="${tool === 'compare'}">⇄ Compare plans</button>
    <button type="button" class="tool-button" data-action="toggle-shared" aria-expanded="${tool === 'shared'}">👥 Shared classes</button>
  </div>`;

  if (myClasses.scheduleMenuOpen) {
    html += `<div class="schedule-menu">
      <label for="schedule-name">Name</label>
      <div class="schedule-menu-row">
        <input type="text" id="schedule-name" maxlength="40" value="${escapeAttr(activeSchedule().name)}">
        <button type="button" class="small-button" data-action="rename-schedule">Save</button>
      </div>
      <button type="button" class="link-button schedule-delete" data-action="delete-schedule">Delete this schedule</button>
    </div>`;
  }
  box.innerHTML = html;
}

// 只需要绑定一次：切换栏里的内容每次都会重画，但外面的容器不变（事件委托）
function initScheduleSwitcher() {
  const box = document.getElementById('schedule-switcher');
  box.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === 'switch-schedule') {
      switchSchedule(Number(button.dataset.schedule));
    } else if (action === 'schedule-menu') {
      myClasses.scheduleMenuOpen = !myClasses.scheduleMenuOpen;
      renderScheduleSwitcher();
      if (myClasses.scheduleMenuOpen) {
        document.getElementById('schedule-name').focus();
      }
    } else if (action === 'rename-schedule') {
      renameSchedule(myClasses.activeId, document.getElementById('schedule-name').value);
    } else if (action === 'delete-schedule') {
      deleteSchedule(myClasses.activeId);
    } else if (action === 'new-schedule') {
      createSchedule(nextScheduleName());
    } else if (action === 'toggle-compare' || action === 'toggle-shared') {
      const tool = action === 'toggle-compare' ? 'compare' : 'shared';
      myClasses.toolOpen = myClasses.toolOpen === tool ? null : tool;
      if (myClasses.toolOpen === 'shared') {
        // 每次打开都从"当前这一份 + 默认的人"开始
        myClasses.sharedBase = myClasses.activeId;
        myClasses.sharedWith = null;
      }
      renderScheduleSwitcher();
      renderCompare();
    }
  });
  // 改名时按回车 = Save
  box.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.target.id === 'schedule-name') {
      renameSchedule(myClasses.activeId, event.target.value);
    }
  });
  // "添加课表"里的"另开一份课表"
  document.getElementById('new-schedule-button').addEventListener('click', function () {
    createSchedule(nextScheduleName());
  });
  // "添加课表"里的"找和朋友相同的课"
  document.getElementById('friend-button').addEventListener('click', startFindShared);
  // 选文件的窗口被取消了：刚新建的空的朋友课表删掉，回到自己的课表
  document.getElementById('schedule-file').addEventListener('cancel', cancelFindShared);
}

console.log('schedules.js loaded');
