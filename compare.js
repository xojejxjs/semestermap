// compare.js：把几份课表放在一起比较（比如 Plan A 和 Plan B）
//
// 有两份以上课表时，切换栏后面有一个 "Compare" 按钮，点开在 My week 最上面显示一张对比表
// 数字全部用现有的函数算：课间步行用 my-week.js 的 findClassWalks，和 "Your walks between classes" 一定一致

// 对比表的每一行
//   better: 'low' 表示越小越好，会标出最好的那一格；没有 better 的行只显示数字
//   （"一周几天有课""最早几点上课"没有绝对的好坏：有人喜欢早上上课）
const COMPARE_ROWS = [
  { key: 'red', label: "🔴 Can't make", better: 'low' },
  { key: 'yellow', label: '🟡 Tight', better: 'low' },
  { key: 'clash', label: '⚠️ Time clashes', better: 'low' },
  { key: 'walkMinutes', label: 'Walking / week', better: 'low' },
  { key: 'buildings', label: 'Buildings', better: 'low' },
  { key: 'days', label: 'Days on campus' },
  { key: 'earliest', label: 'Earliest class' },
  { key: 'notChecked', label: 'Not checked yet' }
];

// 算一份课表的数字
// 输入：这份课表的课（和 myClasses.items 一样的格式）
// 输出：{ red, yellow, clash, walkMinutes, estimate, buildings, days, earliest, notChecked, checked }
function scheduleStats(items) {
  const result = findClassWalks(items);
  const stats = { red: 0, yellow: 0, clash: 0, walkMinutes: 0, estimate: false };

  result.walks.forEach(function (walk) {
    if (walk.kind === 'clash') {
      stats.clash++;
    }
    if (walk.kind === 'walk' && walk.route.verdict === 'red') {
      stats.red++;
    }
    if (walk.kind === 'walk' && walk.route.verdict === 'yellow') {
      stats.yellow++;
    }
    // 一周走多少分钟：每一段路 × 一周走几次。课间很长的也算（两栋楼之间总是要走的），同一栋楼不用走
    if (walk.kind === 'walk' || walk.kind === 'long') {
      const route = walk.route || judgeRoute(measureRoute(walk.from.place, walk.to.place), walk.gap);
      stats.walkMinutes += route.minutes * walk.days.length;
      if (route.isEstimate) {
        stats.estimate = true; // 有用直线估算的路（比如自己输入的地址），数字后面标 est.
      }
    }
  });

  // 不算用户跳过的课
  const active = items.filter(function (c) { return c.status !== 'skipped'; });
  const days = new Set();
  active.forEach(function (c) {
    c.days.forEach(function (d) { days.add(d); });
  });
  const starts = active.filter(function (c) { return c.start != null; }).map(function (c) { return c.start; });

  stats.buildings = new Set(result.checked.map(function (c) { return c.place.id; })).size;
  stats.days = days.size;
  stats.earliest = starts.length > 0 ? Math.min.apply(null, starts) : null;
  stats.notChecked = result.unchecked.length;
  stats.checked = result.checked.length;
  return stats;
}

// ===== 相同的课（Shared classes）：我和几个人（同学、室友）有哪些课是一样的 =====
//
// 以"我"为中心：只看我的课里，哪些在选中的人的课表里也有
//   together：时间一模一样（同一个 section），可以一起上课
//   different：同一门课，但时间不一样（列出对方的时间，方便约着换 section）

// 输入：我的课、[{ schedule, items }]（选中的那几个人）
// 输出：[{ course, title, meetings, togetherMeetings, together: [名字], different: [{ name, when }] }]
//   一起上课的人最多的排最前面
function sharedWithMe(baseItems, others) {
  const groups = [];
  baseItems.forEach(function (c) {
    if (c.status === 'skipped' || !c.course) {
      return;
    }
    const key = c.course.toUpperCase();
    let group = groups.find(function (g) { return g.key === key; });
    if (!group) {
      group = { key: key, course: c.course, title: c.title, meetings: [], together: [], different: [], togetherMeetings: [] };
      groups.push(group);
    }
    group.meetings.push(c);
  });

  groups.forEach(function (group) {
    others.forEach(function (other) {
      const theirs = other.items.filter(function (c) {
        return c.status !== 'skipped' && c.course && c.course.toUpperCase() === group.key;
      });
      if (theirs.length === 0) {
        return;
      }
      // 我的哪几个时段，对方也有一模一样的
      const same = group.meetings.filter(function (m) {
        return theirs.some(function (t) { return sameMeeting(m, t); });
      });
      if (same.length > 0) {
        group.together.push(other.schedule.name);
        same.forEach(function (m) {
          if (!group.togetherMeetings.includes(m)) {
            group.togetherMeetings.push(m);
          }
        });
      } else {
        group.different.push({ name: other.schedule.name, when: theirs.map(shortWhen).join('; ') });
      }
    });
  });

  return groups.filter(function (g) {
    return g.together.length + g.different.length > 0;
  }).sort(function (a, b) {
    return b.together.length - a.together.length ||
      (b.together.length + b.different.length) - (a.together.length + a.different.length) ||
      a.course.localeCompare(b.course);
  });
}

// 每份课表的课：当前这一份以 myClasses.items 为准
function scheduleItems(schedule) {
  return schedule.id === myClasses.activeId ? myClasses.items : schedule.items;
}

// 打开 Shared classes 时默认选谁：标成"朋友"的课表；一个朋友都没有，就选其他所有课表
function defaultSharedWith(baseId) {
  const others = myClasses.schedules.filter(function (s) { return s.id !== baseId; });
  const friends = others.filter(function (s) { return s.kind === 'friend'; });
  return new Set((friends.length > 0 ? friends : others).map(function (s) { return s.id; }));
}

// Shared classes 面板的 HTML
function renderSharedPanel() {
  const schedules = myClasses.schedules;
  // "我"是哪一份：默认是当前这一份；如果当前这一份是朋友的，就用第一份不是朋友的
  let baseId = myClasses.sharedBase;
  if (!schedules.some(function (s) { return s.id === baseId; })) {
    const mine = schedules.find(function (s) { return s.kind !== 'friend'; }) || schedules[0];
    baseId = mine.id;
    myClasses.sharedBase = baseId;
  }
  if (!myClasses.sharedWith) {
    myClasses.sharedWith = defaultSharedWith(baseId);
  }
  myClasses.sharedWith.delete(baseId); // 不能和自己比
  const base = schedules.find(function (s) { return s.id === baseId; });
  const others = schedules.filter(function (s) { return s.id !== baseId; });
  const selected = others.filter(function (s) { return myClasses.sharedWith.has(s.id); });

  let html = '<div class="compare-box shared-box">';
  // 选"我"
  html += '<div class="shared-row"><label for="shared-base">Me</label><select id="shared-base">';
  schedules.forEach(function (s) {
    html += `<option value="${s.id}" translate="no" ${s.id === baseId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`;
  });
  html += '</select></div>';
  // 选"和谁比"：可以多选
  html += '<div class="shared-row"><span class="shared-with-label">With</span><div class="shared-chips">';
  others.forEach(function (s) {
    const on = myClasses.sharedWith.has(s.id);
    html += `<button type="button" class="schedule-chip" data-with="${s.id}" aria-pressed="${on}">${on ? '✓ ' : ''}${keepOriginal(escapeHtml(s.name))}</button>`;
  });
  html += '</div></div>';

  if (selected.length === 0) {
    html += '<p class="hint">Pick at least one person above.</p>';
  } else {
    const groups = sharedWithMe(scheduleItems(base), selected.map(function (s) { return { schedule: s, items: scheduleItems(s) }; }));
    if (groups.length === 0) {
      html += '<p class="hint shared-summary">No classes in common.</p>';
    } else {
      const together = groups.filter(function (g) { return g.together.length > 0; }).length;
      html += `<p class="shared-summary">${groups.length} of your classes ${groups.length === 1 ? 'is' : 'are'} shared` +
        (together > 0 ? ` · ${together} with someone in the same section` : '') + '</p>';
      html += '<ul class="common-list">';
      groups.forEach(function (g) {
        // 有人一起上：写一起上的那个时段；没有：写我的所有时段
        const meetings = g.togetherMeetings.length > 0 ? g.togetherMeetings : g.meetings;
        const when = meetings.map(function (m) {
          return shortWhen(m) + (m.place ? ' · ' + classWhere(m) : '');
        }).join('; ');
        html += `<li><strong translate="no">${escapeHtml(g.title)}</strong> <span class="common-code" translate="no">${escapeHtml(g.course)}</span>
          <span class="common-in">${escapeHtml(when)}</span>`;
        if (g.together.length > 0) {
          html += `<span class="common-same">✓ Together: ${escapeHtml(g.together.join(', '))}</span>`;
        }
        if (g.different.length > 0) {
          const list = g.different.map(function (d) { return `${d.name} (${d.when})`; }).join(', ');
          html += `<span class="common-diff">Different time: ${escapeHtml(list)}</span>`;
        }
        html += '</li>';
      });
      html += '</ul>';
    }
  }
  html += `<p class="hint compare-note">Friends' schedules stay in your browser, like yours.</p>
    <button type="button" class="link-button" data-action="close-tool">Close</button></div>`;
  return html;
}

// 一格里显示的文字
function compareCellText(key, stats) {
  if (key === 'walkMinutes') {
    return `~${stats.walkMinutes} min${stats.estimate ? ' est.' : ''}`;
  }
  if (key === 'earliest') {
    return stats.earliest == null ? '—' : formatClock(stats.earliest);
  }
  return String(stats[key]);
}

// ===== 显示 =====

// 切换栏下面的两个工具：Compare plans（对比表）或 Shared classes（相同的课），一次只开一个
// renderMyClasses() 每次都会调用它
function renderCompare() {
  const box = document.getElementById('schedule-compare');
  if (!myClasses.toolOpen || myClasses.schedules.length < 2) {
    myClasses.toolOpen = null;
    box.innerHTML = '';
    return;
  }
  if (myClasses.toolOpen === 'shared') {
    box.innerHTML = renderSharedPanel();
    return;
  }

  // 每份课表的数字；当前这一份的课以 myClasses.items 为准
  const columns = myClasses.schedules.map(function (schedule) {
    const items = schedule.id === myClasses.activeId ? myClasses.items : schedule.items;
    return { schedule: schedule, items: items, stats: scheduleStats(items) };
  });
  // 还没有一门能检查的课（空的、或者全都没确认地点）：这一列没有可比的数字，不参与"最好"的比较
  const comparable = columns.filter(function (col) { return col.stats.checked > 0; });

  let html = '<div class="compare-box"><div class="compare-scroll"><table class="compare-table"><thead><tr><th></th>';
  columns.forEach(function (col) {
    const current = col.schedule.id === myClasses.activeId;
    // 点表头的名字：换到那一份课表
    html += `<th><button type="button" class="compare-name${current ? ' current' : ''}" data-schedule="${col.schedule.id}"
      ${current ? 'aria-current="true"' : ''} translate="no">${escapeHtml(col.schedule.name)}</button></th>`;
  });
  html += '</tr></thead><tbody>';

  COMPARE_ROWS.forEach(function (row) {
    // 这一行最好的值：只有能比的列多于一列、而且数字不全一样时才标
    let best = null;
    if (row.better === 'low' && comparable.length > 1) {
      const values = comparable.map(function (col) { return col.stats[row.key]; });
      const min = Math.min.apply(null, values);
      if (values.some(function (v) { return v !== min; })) {
        best = min;
      }
    }
    html += `<tr><th scope="row">${row.label}</th>`;
    columns.forEach(function (col) {
      const empty = col.stats.checked === 0;
      const isBest = !empty && best !== null && col.stats[row.key] === best;
      const text = empty ? '—' : compareCellText(row.key, col.stats);
      html += `<td class="${isBest ? 'best' : ''}">${escapeHtml(text)}${isBest ? '<span class="best-tag">best</span>' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += `</tbody></table></div>
    <p class="hint compare-note">Walking / week adds up every walk between back-to-back classes, including long breaks.
      Tap a name to switch to that schedule.</p>
    <button type="button" class="link-button" data-action="close-tool">Close</button></div>`;
  box.innerHTML = html;
}

// 只需要绑定一次（事件委托）
function initCompare() {
  document.getElementById('schedule-compare').addEventListener('click', function (event) {
    const name = event.target.closest('button[data-schedule]');
    if (name) {
      switchSchedule(Number(name.dataset.schedule));
      return;
    }
    // Shared classes：点一个人，勾上 / 取消
    const chip = event.target.closest('button[data-with]');
    if (chip) {
      const id = Number(chip.dataset.with);
      if (myClasses.sharedWith.has(id)) {
        myClasses.sharedWith.delete(id);
      } else {
        myClasses.sharedWith.add(id);
      }
      renderCompare();
      return;
    }
    if (event.target.closest('[data-action="close-tool"]')) {
      myClasses.toolOpen = null;
      renderCompare();
      renderScheduleSwitcher();
    }
  });
  // Shared classes：换了"我"是哪一份
  document.getElementById('schedule-compare').addEventListener('change', function (event) {
    if (event.target.id === 'shared-base') {
      myClasses.sharedBase = Number(event.target.value);
      myClasses.sharedWith = defaultSharedWith(myClasses.sharedBase);
      renderCompare();
    }
  });
}

console.log('compare.js loaded');
