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

function classStopLine(c, text) {
  return `<li class="bp-class"><strong>${escapeHtml(classWhere(c))}</strong> · ${escapeHtml(text)}</li>`;
}

function legLine(leg) {
  if (leg.minutes === 0) {
    return '<li class="bp-leg">↓ same building</li>';
  }
  return `<li class="bp-leg">↓ ${leg.minutes} min walk${leg.isEstimate ? ' (estimate)' : ''}</li>`;
}

function renderBreakPlanner() {
  if (!openBreak) {
    return;
  }
  const walk = openBreak.walk;
  const stops = breakStops(walk);
  const plan = computeBreak(walk, stops);
  const free = breakFreeMinutes(walk);

  let html = `<div class="bp-head"><strong>Plan your break · ${escapeHtml(walk.days.join(', '))}</strong>` +
    '<button type="button" class="bp-icon" data-bp="close" aria-label="Close">✕</button></div>';

  if (stops.length === 0) {
    html += `<p class="hint">${free} free min between these classes. Add the places you want to go: lunch, the library, your dorm… ` +
      'You’ll see when to leave each one and how long you can stay.</p>';
  }

  html += '<ol class="bp-steps">';
  html += classStopLine(walk.from, `class ends ${formatClock(walk.from.end)}`);
  stops.forEach(function (stop, k) {
    const t = plan.stops[k];
    html += legLine(plan.legs[k]);
    const times = t.maxStay < 0
      ? `<span class="bp-late">No time for this stop: ${-t.maxStay} min short</span>`
      : `Arrive ${formatClock(t.arrive)} · leave by ${formatClock(t.leaveBy)} · up to ${formatBreak(t.maxStay)}`;
    html += `<li class="bp-stop">
      <div class="bp-stop-head">
        <span class="day-stop">${stopNumber(k + 1)}</span>
        <strong class="bp-name" title="${escapeAttr(stop.label || stop.name)}">${escapeHtml(stop.name)}</strong>
        <span class="bp-tools">
          <button type="button" class="bp-icon" data-bp="up" data-i="${k}" aria-label="Move up" ${k === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="bp-icon" data-bp="down" data-i="${k}" aria-label="Move down" ${k === stops.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="bp-icon" data-bp="remove" data-i="${k}" aria-label="Remove">✕</button>
        </span>
      </div>
      ${stop.placeId ? '' : `<div class="bp-address">${escapeHtml(stop.label)}</div>`}
      <div class="bp-times">${times}</div>
      <label class="bp-stay">Stay <input type="number" min="0" max="600" inputmode="numeric" data-bp-stay="${k}" value="${stop.stay > 0 ? stop.stay : ''}" placeholder="–"> min</label>
    </li>`;
  });
  html += legLine(plan.legs[plan.legs.length - 1]);
  html += classStopLine(walk.to, `class starts ${formatClock(walk.to.start)} (be there by ${formatClock(walk.to.start - BUFFER_MINUTES)})`);
  html += '</ol>';

  // 结论：和 🟢🟡🔴 同一套规则
  if (stops.length > 0) {
    const stayed = sum(plan.stops.map(function (t) { return t.stay; }));
    let verdict;
    if (plan.verdict === 'red') {
      verdict = `🔴 You’d be ${-plan.spare} min late. Remove a stop${stops.length > 1 ? ' or try a different order' : ''}.`;
    } else if (plan.verdict === 'yellow') {
      verdict = `🟡 Tight: only ${plan.spare} min to spare at your next class.`;
    } else {
      const left = plan.spare - BUFFER_MINUTES;
      verdict = `🟢 Fits · ${plan.walking} min walking · ${left} free min ${stayed > 0 ? 'left' : 'at your stops'}`;
    }
    html += `<p class="bp-verdict bp-${plan.verdict}">${verdict}</p>`;
    const better = bestBreakOrder(walk, stops);
    if (better) {
      html += `<p class="bp-best">💡 A different order saves ${better.saves} min of walking. ` +
        '<button type="button" class="link-button" data-bp="best">Use best order</button></p>';
    }
  }

  // 加一个地方：我们的地点、自己的课，或者任何能在地图上找到的地方（店名、地址）
  html += `<form class="bp-add" data-bp-form>
      <input type="search" list="place-options" placeholder="Add a stop: a place, shop or address" aria-label="Add a stop" data-bp-input>
      <button type="submit" class="small-button">Add</button>
    </form>`;
  html += renderBreakPicks();
  html += '<p class="hint bp-message" data-bp-message></p>';

  if (stops.length > 0) {
    html += renderBreakMapsLink(plan.points);
  }
  openBreak.box.innerHTML = html;
}

// 快捷地点：和 Directions 一样的 Recent + Popular（app.js）
function renderBreakPicks() {
  const recent = loadRecentDestinations();
  const popular = routePopular.filter(function (p) {
    return !recent.some(function (r) { return r.toLowerCase() === p.value.toLowerCase(); });
  });
  const chips = function (items) {
    return items.map(function (item) {
      return `<button type="button" class="pick-chip" data-bp-pick="${escapeAttr(item.value)}">${escapeHtml(item.label)}</button>`;
    }).join('');
  };
  let html = '';
  if (recent.length > 0) {
    html += `<div class="pick-row"><span class="pick-label">Recent</span>${chips(recent.map(function (r) {
      const known = routePopular.find(function (p) { return p.value.toLowerCase() === r.toLowerCase(); });
      return { label: known ? known.label : r, value: r };
    }))}</div>`;
  }
  if (popular.length > 0) {
    html += `<div class="pick-row"><span class="pick-label">Popular</span>${chips(popular)}</div>`;
  }
  return html;
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
  openBreak = { walk: walk, box: box };
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
  logEvent('break-stop-add');
  // 下次在 Recent 里一点就有（app.js）；是我们自己的地点就存正式名字，和 Popular 里的对得上，不会出现两次
  if (!findMyClass(text, false)) {
    rememberRecentDestination(stop.placeId ? stop.label : text);
  }
  breakStopsChanged();
  const input = openBreak.box.querySelector('[data-bp-input]');
  if (input && !isPhoneLayout()) {
    input.focus(); // 电脑上可以接着加下一个
  }
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
  if (action === 'remove') {
    stops.splice(i, 1);
  } else if (action === 'up' && i > 0) {
    stops.splice(i - 1, 0, stops.splice(i, 1)[0]);
  } else if (action === 'down' && i < stops.length - 1) {
    stops.splice(i + 1, 0, stops.splice(i, 1)[0]);
  } else if (action === 'best') {
    const better = bestBreakOrder(openBreak.walk, stops);
    if (!better) {
      return;
    }
    const reordered = better.order.map(function (k) { return stops[k]; });
    stops.splice(0, stops.length);
    reordered.forEach(function (s) { stops.push(s); });
    logEvent('break-best-order');
  } else {
    return;
  }
  breakStopsChanged();
}

// 改停留时间：只重新算时间，不重画地图（路线没变）；光标留在输入框里
function handleBreakInput(event) {
  const input = event.target.closest('[data-bp-stay]');
  if (!input || !openBreak) {
    return;
  }
  const k = Number(input.dataset.bpStay);
  const value = parseInt(input.value, 10);
  breakStops(openBreak.walk)[k].stay = value > 0 ? Math.min(value, 600) : null;
  saveBreakPlans(openBreak.walk);
  const cursor = input.selectionStart;
  renderBreakPlanner();
  const again = openBreak.box.querySelector(`[data-bp-stay="${k}"]`);
  if (again) {
    again.focus();
    try {
      again.setSelectionRange(cursor, cursor);
    } catch (error) {
      // number 输入框有的浏览器不支持设置光标位置，没关系
    }
  }
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
  box.addEventListener('input', handleBreakInput);
  box.addEventListener('submit', handleBreakSubmit);
}

console.log('gap-planner.js loaded');
