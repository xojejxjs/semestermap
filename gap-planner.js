// gap-planner.js：课间规划（Plan this break）
//
// 用户在两节课之间想去几个地方（吃饭、图书馆、回宿舍……），按自己的顺序加进来
// 我们算出每个地方：最早几点到、最晚几点要走、最多能待多久；最后能不能准时到下一节课
//
// 时间怎么分：几个地方共用课间的空闲时间
//   最早几点到 = 上一节课下课 + 前面的路 + 前面设好的停留时间
//   最晚几点走 = 下一节课开始 − 缓冲 − 后面的路 − 后面设好的停留时间
//   最多能待多久 = 最晚几点走 − 最早几点到
// 用户给某个地方填了停留时间，其他地方的时间自动跟着变
//
// 入口：My week 里点一段路 → 展开的卡片里 "＋ Plan this break"（只在课间有空余时间时出现）

const BREAK_MIN_FREE = 10;  // 扣掉步行和缓冲以后，至少还剩几分钟，才值得规划
const BEST_ORDER_MAX = 6;   // 最多几个地方时才试所有顺序（6 个 = 720 种，一下就算完）

let openBreak = null;       // 现在打开的是哪一段课间：{ walk, box }
const realLegs = {};        // 后端算出的真实路线：key 是 "起点>终点" 的坐标，value 是 { minutes, path }

// ===== 存储：每份课表各自存，key 是这一对课 =====

function breakKey(walk) {
  return [walk.from.course, walk.from.start, walk.to.course, walk.to.start].join('|');
}

function breakStops(walk) {
  const schedule = activeSchedule();
  schedule.breakPlans = schedule.breakPlans || {};
  if (!schedule.breakPlans[breakKey(walk)]) {
    schedule.breakPlans[breakKey(walk)] = [];
  }
  return schedule.breakPlans[breakKey(walk)];
}

function saveBreakPlans(walk) {
  const schedule = activeSchedule();
  if (schedule.breakPlans && breakStops(walk).length === 0) {
    delete schedule.breakPlans[breakKey(walk)]; // 一个地方都没有了：不存空的
  }
  saveMyClasses();
}

// ===== 什么时候显示 "＋ Plan this break" =====

function walkMinutes(fromPlace, toPlace) {
  return fromPlace.id === toPlace.id ? 0 : Math.ceil(measureRoute(fromPlace, toPlace).minutes);
}

// 课间扣掉直接走过去和缓冲以后，还剩几分钟
function breakFreeMinutes(walk) {
  return walk.gap - walkMinutes(walk.from.place, walk.to.place) - BUFFER_MINUTES;
}

function canPlanBreak(walk) {
  return walk.kind !== 'clash' && breakFreeMinutes(walk) >= BREAK_MIN_FREE;
}

// 展开的卡片里那一行按钮；已经有规划的显示 "Your break plan (2 stops)"
function renderPlanBreakButton(walk) {
  const stops = activeSchedule().breakPlans && activeSchedule().breakPlans[breakKey(walk)];
  const label = stops && stops.length > 0
    ? `✎ Your break plan (${stops.length} ${stops.length === 1 ? 'stop' : 'stops'})`
    : '＋ Plan this break';
  return `<p class="plan-break-row"><button type="button" class="plan-break-button" data-bp="open">${label}</button></p>`;
}

// ===== 计算 =====

// 存下来的一个地方 → 和其他地点一样的对象（measureRoute、画地图都能用）
function stopPlace(stop) {
  if (stop.placeId) {
    const entry = myClasses.placeIndex.find(function (e) { return e.place.id === stop.placeId; });
    if (entry) {
      return entry.place;
    }
  }
  return { id: 'stop:' + stop.latitude + ',' + stop.longitude, name: stop.name, latitude: stop.latitude, longitude: stop.longitude, kind: 'address' };
}

function legKey(a, b) {
  return a.latitude + ',' + a.longitude + '>' + b.latitude + ',' + b.longitude;
}

// 一段路要走几分钟：两头都在步行时间表里就查表；否则用后端的真实路线（拿到了的话），再不然用直线估算
function legMinutes(a, b) {
  if (a.id === b.id) {
    return { minutes: 0, isEstimate: false };
  }
  const route = measureRoute(a, b);
  if (!route.isEstimate) {
    return { minutes: Math.ceil(route.minutes), isEstimate: false };
  }
  const real = realLegs[legKey(a, b)];
  if (real) {
    return { minutes: real.minutes, isEstimate: false };
  }
  return { minutes: Math.ceil(route.minutes), isEstimate: true };
}

function sum(list) {
  return list.reduce(function (total, x) { return total + x; }, 0);
}

// 输入：那段课间、要去的地方（按顺序）
// 输出：{ points, legs, stops: [{ arrive, leaveBy, maxStay, stay }], walking, spare, verdict }
function computeBreak(walk, stops) {
  const points = [walk.from.place].concat(stops.map(stopPlace), [walk.to.place]);
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    legs.push(legMinutes(points[i], points[i + 1]));
  }
  const legMins = legs.map(function (leg) { return leg.minutes; });
  const stays = stops.map(function (s) { return s.stay > 0 ? s.stay : 0; });
  const start = walk.from.end;
  const deadline = walk.to.start - BUFFER_MINUTES;

  const timing = stops.map(function (stop, k) {
    const arrive = start + sum(legMins.slice(0, k + 1)) + sum(stays.slice(0, k));
    const leaveBy = deadline - sum(legMins.slice(k + 1)) - sum(stays.slice(k + 1));
    return { arrive: arrive, leaveBy: leaveBy, maxStay: leaveBy - arrive, stay: stays[k] };
  });

  const walking = sum(legMins);
  // 和其他地方一样的规则：到了以后还剩 ≥ 缓冲 → 🟢；0 到缓冲之间 → 🟡；会迟到 → 🔴
  const spare = walk.gap - walking - sum(stays);
  const verdict = spare >= BUFFER_MINUTES ? 'green' : (spare >= 0 ? 'yellow' : 'red');
  return { points: points, legs: legs, stops: timing, walking: walking, spare: spare, verdict: verdict };
}

// 试所有顺序，看有没有更省路的；省 2 分钟以上才提示
function bestBreakOrder(walk, stops) {
  if (stops.length < 2 || stops.length > BEST_ORDER_MAX) {
    return null;
  }
  const places = stops.map(stopPlace);
  const cost = function (order) {
    const route = [walk.from.place].concat(order.map(function (i) { return places[i]; }), [walk.to.place]);
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      total += legMinutes(route[i], route[i + 1]).minutes;
    }
    return total;
  };
  const current = stops.map(function (s, i) { return i; });
  let best = { order: current, cost: cost(current) };
  // 所有排列（地方很少，直接全试）
  (function permute(prefix, rest) {
    if (rest.length === 0) {
      const c = cost(prefix);
      if (c < best.cost) {
        best = { order: prefix, cost: c };
      }
      return;
    }
    rest.forEach(function (x, i) {
      permute(prefix.concat([x]), rest.slice(0, i).concat(rest.slice(i + 1)));
    });
  })([], current);
  const saves = cost(current) - best.cost;
  return saves >= 2 ? { order: best.order, saves: saves } : null;
}

// ===== 显示 =====

// 显示用的名字：去掉后面括号里的楼代码（"Mugar Memorial Library (MUG)" → "Mugar Memorial Library"），读起来短一些
function stopDisplayName(stop) {
  return String(stop.name || '').replace(/\s*\([A-Z&]{2,5}\)$/, '');
}

// 顶上一句人话：能不能准时到、最晚几点要走（这是用户最想知道的，所以放第一行）
function renderBreakHeadline(walk, stops, plan) {
  const where = escapeHtml(classWhere(walk.to));
  if (stops.length === 0) {
    return `<p class="bp-headline">${breakFreeMinutes(walk)} free min before ${where}</p>` +
      '<p class="hint bp-sub">Add the places you want to go: lunch, the library, your dorm, any shop. ' +
      'You’ll see when to leave each one.</p>';
  }
  const last = stops.length - 1;
  const leaveLast = `Leave ${escapeHtml(stopDisplayName(stops[last]))} by ${formatClock(plan.stops[last].leaveBy)} at the latest`;
  if (plan.verdict === 'red') {
    return `<p class="bp-headline bp-red">🔴 You’d be ${-plan.spare} min late to ${where}</p>` +
      `<p class="bp-sub">Remove a stop${stops.length > 1 ? ' or try a different order' : ''}.</p>`;
  }
  if (plan.verdict === 'yellow') {
    return `<p class="bp-headline bp-yellow">🟡 Tight: only ${plan.spare} min to spare at ${where}</p>` +
      `<p class="bp-sub">${leaveLast}</p>`;
  }
  return `<p class="bp-headline bp-green">🟢 You’ll make ${where} with ${plan.spare} min to spare</p>` +
    `<p class="bp-sub">${leaveLast}</p>`;
}

// 行程单的一行：左边时间，右边内容
function breakRow(time, content, extraClass) {
  return `<li class="bp-row ${extraClass || ''}"><span class="bp-time">${time ? escapeHtml(formatClock(time)) : ''}</span>` +
    `<div class="bp-what">${content}</div></li>`;
}

function breakLegRow(leg) {
  const text = leg.minutes === 0 ? 'same building' : `${leg.minutes} min walk${leg.isEstimate ? ' (estimate)' : ''}`;
  return `<li class="bp-row bp-leg"><span class="bp-time"></span><div class="bp-what">${text}</div></li>`;
}

// 一个地方：平时只有名字、地址、停留时间；点了才展开编辑（停留时间 − / +、换位置、删除）
function breakStopRow(stop, t, k, count) {
  const expanded = openBreak.expanded === k;
  let stay;
  if (t.maxStay < 0) {
    stay = `<span class="bp-late">${-t.maxStay} min short</span>`;
  } else if (t.stay > 0) {
    stay = `${t.stay} min`;
  } else {
    stay = `up to ${formatBreak(t.maxStay)}`;
  }
  let html = `<button type="button" class="bp-stop-toggle" data-bp="toggle" data-i="${k}" aria-expanded="${expanded}">` +
    `<span class="day-stop">${stopNumber(k + 1)}</span>` +
    `<strong class="bp-name">${escapeHtml(stopDisplayName(stop))}</strong>` +
    `<span class="bp-stay-summary">${stay} ${expanded ? '⌃' : '›'}</span></button>`;
  if (!stop.placeId) {
    html += `<div class="bp-address">${escapeHtml(stop.label)}</div>`;
  }
  if (expanded) {
    html += `<div class="bp-edit">
      <div class="bp-stepper">
        <span class="bp-edit-label">Stay</span>
        <button type="button" class="bp-step" data-bp="less" data-i="${k}" aria-label="5 minutes less">−</button>
        <span class="bp-step-value">${t.stay > 0 ? t.stay + ' min' : 'not set'}</span>
        <button type="button" class="bp-step" data-bp="more" data-i="${k}" aria-label="5 minutes more">+</button>
        <span class="hint">leave by ${formatClock(t.leaveBy)}${t.maxStay >= 0 ? ' · up to ' + formatBreak(t.maxStay) : ''}</span>
      </div>
      <div class="bp-edit-links">
        ${k > 0 ? `<button type="button" class="link-button" data-bp="up" data-i="${k}">Move up</button>` : ''}
        ${k < count - 1 ? `<button type="button" class="link-button" data-bp="down" data-i="${k}">Move down</button>` : ''}
        <button type="button" class="link-button bp-remove" data-bp="remove" data-i="${k}">Remove</button>
      </div>
    </div>`;
  }
  return breakRow(t.arrive, html, 'bp-stop' + (expanded ? ' bp-open' : ''));
}

function renderBreakPlanner() {
  if (!openBreak) {
    return;
  }
  const walk = openBreak.walk;
  const stops = breakStops(walk);
  const plan = computeBreak(walk, stops);

  let html = `<div class="bp-head"><span class="bp-title">Plan your break · ${escapeHtml(walk.days.join(', '))}</span>` +
    '<button type="button" class="bp-close" data-bp="close" aria-label="Close">✕</button></div>';
  html += renderBreakHeadline(walk, stops, plan);

  const better = bestBreakOrder(walk, stops);
  if (better) {
    html += `<p class="bp-best">💡 A different order saves ${better.saves} min. ` +
      '<button type="button" class="link-button" data-bp="best">Use it</button></p>';
  }

  // 行程单：下课 → ① → ② → 上课
  html += '<ol class="bp-steps">';
  html += breakRow(walk.from.end, `<strong>${escapeHtml(classWhere(walk.from))}</strong> · class ends`, 'bp-class');
  stops.forEach(function (stop, k) {
    html += breakLegRow(plan.legs[k]);
    html += breakStopRow(stop, plan.stops[k], k, stops.length);
  });
  html += breakLegRow(plan.legs[plan.legs.length - 1]);
  const arrive = walk.from.end + plan.walking + sum(plan.stops.map(function (t) { return t.stay; }));
  html += breakRow(arrive, `<strong>${escapeHtml(classWhere(walk.to))}</strong> · class at ${formatClock(walk.to.start)}`, 'bp-class');
  html += '</ol>';

  // 加一个地方：平时只有一行 "＋ Add a stop"，点了才展开；还没有地方时直接展开
  if (openBreak.adding || stops.length === 0) {
    html += `<form class="bp-add" data-bp-form>
        <input type="search" list="place-options" placeholder="A place, shop or address" aria-label="Add a stop" data-bp-input>
        <button type="submit" class="small-button">Add</button>
      </form>`;
    html += renderBreakPicks(stops);
    html += '<p class="hint bp-message" data-bp-message></p>';
  } else {
    html += '<button type="button" class="bp-add-toggle" data-bp="adding">＋ Add a stop</button>';
  }

  if (stops.length > 0) {
    html += renderBreakMapsLink(plan.points);
  }
  openBreak.box.innerHTML = html;
}

// 快捷地点：最近用过的在前，然后是大家常去的；合成一行，最多 4 个；已经在规划里的不再出现
function renderBreakPicks(stops) {
  const added = stops.map(function (s) { return (s.label || '').toLowerCase(); })
    .concat(stops.map(function (s) { return (s.name || '').toLowerCase(); }));
  const items = [];
  const push = function (label, value) {
    const v = value.toLowerCase();
    if (items.length < 4 && added.indexOf(v) === -1 && !items.some(function (x) { return x.value.toLowerCase() === v; })) {
      items.push({ label: label, value: value });
    }
  };
  loadRecentDestinations().forEach(function (r) {
    const known = routePopular.find(function (p) { return p.value.toLowerCase() === r.toLowerCase(); });
    push(known ? known.label : r, r);
  });
  routePopular.forEach(function (p) { push(p.label, p.value); });
  if (items.length === 0) {
    return '';
  }
  return '<div class="bp-picks">' + items.map(function (item) {
    return `<button type="button" class="pick-chip" data-bp-pick="${escapeAttr(item.value)}">${escapeHtml(item.label)}</button>`;
  }).join('') + '</div>';
}

// Google Maps 支持中途站（waypoints）：一个链接就是 下课的楼 → ① → ② → 上课的楼
// Apple Maps 的链接不支持中途站，所以这里只给 Google
function renderBreakMapsLink(points) {
  const origin = placeCoords(points[0]);
  const destination = placeCoords(points[points.length - 1]);
  const waypoints = points.slice(1, -1).map(placeCoords).join('|');
  const url = 'https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=' + origin +
    '&destination=' + destination + '&waypoints=' + encodeURIComponent(waypoints);
  return `<p class="route-open"><a href="${url}" target="_blank" rel="noopener" data-open-maps="google">Open the whole plan in Google Maps ›</a></p>`;
}

// 地图：画出整条路线；没有真实路线的段先画直线，拿到以后再换成沿街道的
function drawBreakOnMap() {
  if (!openBreak) {
    return;
  }
  const plan = computeBreak(openBreak.walk, breakStops(openBreak.walk));
  const paths = [];
  for (let i = 0; i < plan.points.length - 1; i++) {
    const real = realLegs[legKey(plan.points[i], plan.points[i + 1])];
    paths.push(real ? real.path : null);
  }
  drawBreakRoute(plan.points, paths);
}

// 问后端要每一段的真实路线（画沿街道的线；不在步行时间表里的地方，时间也换成真实的）
async function fetchBreakLegs() {
  if (!openBreak) {
    return;
  }
  const walk = openBreak.walk;
  const points = computeBreak(walk, breakStops(walk)).points;
  let changed = false;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const key = legKey(a, b);
    if (a.id === b.id || realLegs[key]) {
      continue;
    }
    const real = await fetchRealRoute(a, b);
    if (real) {
      realLegs[key] = { minutes: Math.ceil(real.seconds / 60), path: real.path };
      changed = true;
    }
  }
  // 等的时候用户可能关掉了、或者换了一段课间
  if (changed && openBreak && openBreak.walk === walk) {
    renderBreakPlanner();
    drawBreakOnMap();
  }
}

// 地点改了（加、删、换顺序）：重新显示、存起来、重画地图
function breakStopsChanged() {
  saveBreakPlans(openBreak.walk);
  renderBreakPlanner();
  drawBreakOnMap();
  fetchBreakLegs();
}

// ===== 操作 =====

// 打开：放在这段路的卡片下面
function openBreakPlanner(walk, li) {
  closeBreakPlanner();
  const box = document.createElement('div');
  box.className = 'break-planner';
  li.appendChild(box);
  // expanded：哪个地方展开了编辑区；adding："Add a stop" 有没有展开
  openBreak = { walk: walk, box: box, expanded: null, adding: false };
  logEvent('break-plan-open');
  renderBreakPlanner();
  drawBreakOnMap();
  fetchBreakLegs();
  box.scrollIntoView({ block: 'nearest' });
}

function closeBreakPlanner() {
  if (openBreak) {
    openBreak.box.remove();
    openBreak = null;
  }
}

// 把用户输入的文字变成一个地方
// 顺序：1. 我们的地点（名字、别名、代码）2. 自己的课  3. 地图上搜（店名、地名、地址），挑离下课那栋楼最近的
// 按"词"找我们自己的地点：输入的每个词都出现在名字、别名或代码里才算（"Mugar Library" → Mugar Memorial Library）
// 有好几个都符合时，用名字最短的（最贴近输入的）
function matchOurPlace(text) {
  const words = text.toLowerCase().split(/[^a-z0-9&']+/).filter(function (w) { return w.length > 1; });
  if (words.length === 0) {
    return null;
  }
  const matches = myClasses.placeIndex.map(function (e) { return e.place; }).filter(function (p) {
    const hay = [p.name, p.code || ''].concat(p.aliases || [], p.units || []).join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  });
  matches.sort(function (a, b) { return a.name.length - b.name.length; });
  return matches[0] || null;
}

function ourStop(place) {
  return { name: place.name, label: place.name, placeId: place.id, latitude: place.latitude, longitude: place.longitude };
}

async function resolveBreakStop(text, near) {
  const place = findPlace(myClasses.placeIndex, text, false) || matchOurPlace(text);
  if (place) {
    return ourStop(place);
  }
  const mine = findMyClass(text, false);
  if (mine) {
    return { name: mine.name, label: mine.name, placeId: mine.id, latitude: mine.latitude, longitude: mine.longitude };
  }
  const found = await geocodePlaceNear(text, near);
  if (found) {
    return { name: found.name, label: found.label, placeId: null, latitude: found.latitude, longitude: found.longitude };
  }
  // 地图上也搜不到：最后再试一下我们地点名字的一部分
  const partial = findPlace(myClasses.placeIndex, text, true);
  return partial ? ourStop(partial) : null;
}

async function addBreakStop(text) {
  text = text.trim();
  if (!text || !openBreak) {
    return;
  }
  const walk = openBreak.walk;
  const message = openBreak.box.querySelector('[data-bp-message]');
  if (message) {
    message.textContent = `Looking up "${text}"…`;
  }
  // 店名有很多家时，挑最顺路的：从上一节课过去 + 再去下一节课，两段加起来最短
  const stop = await resolveBreakStop(text, [walk.from.place, walk.to.place]);
  if (!openBreak || openBreak.walk !== walk) {
    return; // 等的时候关掉了
  }
  if (!stop) {
    const box = openBreak.box.querySelector('[data-bp-message]');
    if (box) {
      box.textContent = `Couldn’t find "${text}" near campus. Try the full name or a street address.`;
    }
    return;
  }
  stop.stay = null;
  breakStops(walk).push(stop);
  openBreak.adding = false; // 加好了：收起输入框，页面回到干净的行程单
  logEvent('break-stop-add');
  // 下次在 Recent 里一点就有（app.js）；是我们自己的地点就存正式名字，和 Popular 里的对得上，不会出现两次
  if (!findMyClass(text, false)) {
    rememberRecentDestination(stop.placeId ? stop.label : stop.name); // 存找到的正式名字（"Target"），不是用户打的 "target"
  }
  breakStopsChanged();
}

function handleBreakClick(event) {
  const target = event.target.closest('[data-bp], [data-bp-pick]');
  if (!target) {
    return;
  }
  // "＋ Plan this break"：在这段路的卡片下面打开
  if (target.dataset.bp === 'open') {
    const li = target.closest('li');
    const row = li && li.querySelector('button[data-walk]');
    const walk = row && shownWalks[Number(row.dataset.walk)];
    if (walk) {
      if (openBreak && openBreak.walk === walk) {
        closeBreakPlanner();
      } else {
        openBreakPlanner(walk, li);
      }
    }
    return;
  }
  if (!openBreak) {
    return;
  }
  if (target.dataset.bpPick) {
    addBreakStop(target.dataset.bpPick);
    return;
  }
  const stops = breakStops(openBreak.walk);
  const i = Number(target.dataset.i);
  const action = target.dataset.bp;
  if (action === 'close') {
    closeBreakPlanner();
    return;
  }
  // 只改显示的操作：展开 / 收起一个地方、展开 "Add a stop"
  if (action === 'toggle') {
    openBreak.expanded = openBreak.expanded === i ? null : i;
    renderBreakPlanner();
    return;
  }
  if (action === 'adding') {
    openBreak.adding = true;
    openBreak.expanded = null;
    renderBreakPlanner();
    const input = openBreak.box.querySelector('[data-bp-input]');
    if (input) {
      input.focus();
    }
    return;
  }
  // 停留时间：每次 5 分钟；从"没设"开始按 + 直接到 15 分钟（大多数停留不会只有 5 分钟）
  if (action === 'more' || action === 'less') {
    const stay = stops[i].stay || 0;
    let next = action === 'more' ? (stay === 0 ? 15 : stay + 5) : stay - 5;
    next = next > 0 ? Math.min(next, 600) : null;
    stops[i].stay = next;
    saveBreakPlans(openBreak.walk);
    renderBreakPlanner(); // 路线没变，不用重画地图
    return;
  }
  // 改变地点顺序或数量的操作：要重新算、重画地图
  if (action === 'remove') {
    stops.splice(i, 1);
    openBreak.expanded = null;
  } else if (action === 'up' && i > 0) {
    stops.splice(i - 1, 0, stops.splice(i, 1)[0]);
    openBreak.expanded = i - 1; // 跟着这个地方走，编辑区还开着
  } else if (action === 'down' && i < stops.length - 1) {
    stops.splice(i + 1, 0, stops.splice(i, 1)[0]);
    openBreak.expanded = i + 1;
  } else if (action === 'best') {
    const better = bestBreakOrder(openBreak.walk, stops);
    if (!better) {
      return;
    }
    const reordered = better.order.map(function (k) { return stops[k]; });
    stops.splice(0, stops.length);
    reordered.forEach(function (s) { stops.push(s); });
    openBreak.expanded = null;
    logEvent('break-best-order');
  } else {
    return;
  }
  breakStopsChanged();
}

function handleBreakSubmit(event) {
  if (!event.target.matches('[data-bp-form]')) {
    return;
  }
  event.preventDefault();
  const input = event.target.querySelector('[data-bp-input]');
  addBreakStop(input.value);
}

// 只需要绑定一次：规划面板放在 #class-walks 里面（事件委托）
function initBreakPlanner() {
  const box = document.getElementById('class-walks');
  box.addEventListener('click', handleBreakClick);
  box.addEventListener('submit', handleBreakSubmit);
}

console.log('gap-planner.js loaded');
