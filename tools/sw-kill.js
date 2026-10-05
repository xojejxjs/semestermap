// tools/sw-kill.js：Service Worker 的"一键关闭"（平时不用）
//
// 什么时候用：sw.js 出了问题（比如手机一直显示旧版本、打不开）
// 怎么用：把下面的代码整个复制到网站根目录的 sw.js 里（替换原来的内容），提交、推送
// 效果：每台设备下次打开网站时，Service Worker 会清掉所有缓存、注销自己，网站变回普通网页
// 修好以后，再把正常的 sw.js 放回去即可

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll(); })
      .then(function (clients) {
        // 打开着的页面刷新一次，换成没有 Service Worker 的普通网页
        clients.forEach(function (client) { client.navigate(client.url); });
      })
  );
});
