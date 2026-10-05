// sw.js：Service Worker（让网站可以加到手机主屏幕，并且没网时也能打开）
//
// 最重要的原则：有网时永远先拿最新版本，只有没网（或网络太慢）时才用存好的
//   → 联网的设备永远是最新版，不会"卡在旧版本"
//
// 只管两类请求：自己网站的文件、地图库 Leaflet（unpkg.com）
// 其他一律不碰，照常走网络：访问统计、后端路线、地址搜索、地图底图……
//
// 万一出问题的"一键关闭"：
//   1. 把 tools/sw-kill.js 的内容复制到这个文件，推送 → 所有设备上的 Service Worker 会自己注销、清掉缓存
//   2. 或者单台设备：打开 网址?nosw（pwa.js 会注销并清掉缓存）

const CACHE = 'walkmyweek-v1';
const CDN_HOSTS = ['unpkg.com'];
const NETWORK_TIMEOUT_MS = 6000; // 网络超过这么久还没回来，而手里有存好的，就先用存好的

self.addEventListener('install', function () {
  self.skipWaiting(); // 新版本马上接手，不用等所有页面都关掉
});

self.addEventListener('activate', function (event) {
  // 清掉旧名字的缓存，然后马上接管已经打开的页面
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && CDN_HOSTS.indexOf(url.hostname) === -1) {
    return; // 不是我们的文件：不管，浏览器照常处理
  }
  event.respondWith(networkFirst(request, url));
});

// 存的时候用的 key：打开网页（导航）不管后面带什么参数（?utm_source=…），都存成同一份
function cacheKey(request, url) {
  if (request.mode === 'navigate') {
    return new Request(url.origin + url.pathname);
  }
  return request;
}

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(request, url);
  const network = fetch(request).then(function (response) {
    // 在后台存一份最新的（不等它存完，网页马上拿到文件）；opaque 是 Leaflet 这种跨网站的文件（看不到内容，但可以存）
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(key, response.clone())
        .then(function () { return removeOlderVersions(cache, url); })
        .catch(function () {});
    }
    return response;
  });
  network.catch(function () {}); // 已经用了存好的那份时，网络后来失败也不用报错（下面 await 时照样能拿到错误）

  // 网络太慢：如果手里有存好的，先用存好的；没有的话继续等网络
  const timeout = new Promise(function (resolve) {
    setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout');
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') {
      return first;
    }
    const cached = await cache.match(key);
    return cached || await network;
  } catch (error) {
    // 没网：用存好的
    const cached = await cache.match(key);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

// 文件名后面带版本号（app.js?v=2026-10-04k）：存了新版本，就删掉同一个文件的旧版本，缓存不会越积越多
async function removeOlderVersions(cache, url) {
  if (!url.searchParams.has('v')) {
    return;
  }
  const keys = await cache.keys();
  await Promise.all(keys.map(function (k) {
    const old = new URL(k.url);
    if (old.origin === url.origin && old.pathname === url.pathname && old.search !== url.search) {
      return cache.delete(k);
    }
    return null;
  }));
}
