// pwa.js：加到手机主屏幕 + 没网时也能打开
//
// 1. 注册 Service Worker（sw.js）；网址带 ?nosw 时反过来：注销它、清掉缓存（单台设备的"一键关闭"）
// 2. "加到主屏幕"的提示：只放在 My classes 下面一小行，不弹窗；关掉以后不再出现
//    Android / 电脑 Chrome：浏览器允许时显示 "Install as an app" 按钮
//    iPhone Safari：苹果不允许网页直接安装，只能告诉用户怎么点（Share → Add to Home Screen）
// 3. 没网时最上面一条小提示：哪些功能还能用

const INSTALL_DISMISSED_KEY = 'bu-dorm-dash:install-hint-dismissed';
let installPrompt = null; // Chrome 给的"安装"机会（beforeinstallprompt），用户点按钮时才用

// ===== 1. Service Worker =====

if ('serviceWorker' in navigator) {
  if (location.search.indexOf('nosw') !== -1) {
    // 单台设备出问题时：打开 网址?nosw → 注销、清缓存
    // 先注销；等这一页的文件都加载完（这一页还是旧的 Service Worker 送来的，它会顺手存缓存）再清缓存
    navigator.serviceWorker.getRegistrations()
      .then(function (registrations) {
        return Promise.all(registrations.map(function (r) { return r.unregister(); }));
      })
      .then(function () {
        window.addEventListener('load', function () {
          setTimeout(function () {
            if (window.caches) {
              caches.keys().then(function (keys) { keys.forEach(function (k) { caches.delete(k); }); });
            }
          }, 1000);
        });
        console.log('Service worker removed (?nosw)');
      });
  } else {
    // 等网页加载完再注册，不和地图、课表抢网络
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (error) {
        console.log('Service worker not registered:', error.message);
      });
    });
  }
}

// ===== 2. 加到主屏幕的提示 =====

// 已经是从主屏幕打开的（像 App 一样全屏）：不用再提示
function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// iPhone / iPad 上的 Safari（不是 iPhone 上的 Chrome、Firefox：它们的菜单不一样）
function isIosSafari() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function installHintDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch (error) {
    return false;
  }
}

// My classes 下面的那一小行（renderMyClasses 每次重画列表后调用）
function updateInstallRow() {
  const row = document.getElementById('install-row');
  if (!row) {
    return;
  }
  let html = '';
  if (!isInstalledApp() && !installHintDismissed()) {
    if (installPrompt) {
      html = '<button type="button" class="link-button install-button" data-install="go">📱 Install as an app</button>';
    } else if (isIosSafari()) {
      html = '<span class="install-tip">📱 Add to your Home Screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</span>';
    }
    if (html) {
      html += ' <button type="button" class="install-dismiss" data-install="dismiss" aria-label="Hide this tip">✕</button>';
    }
  }
  row.innerHTML = html;
  row.hidden = !html;
}

// Chrome 觉得可以安装时会发这个事件：先存着，等用户自己点按钮
window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  installPrompt = event;
  updateInstallRow();
});

window.addEventListener('appinstalled', function () {
  installPrompt = null;
  logEvent('pwa-installed');
  updateInstallRow();
});

document.addEventListener('click', async function (event) {
  const button = event.target.closest('[data-install]');
  if (!button) {
    return;
  }
  if (button.dataset.install === 'dismiss') {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch (error) {
      // 存不了就算了：这次先隐藏
    }
    document.getElementById('install-row').hidden = true;
    return;
  }
  if (installPrompt) {
    logEvent('pwa-install-prompt');
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      installPrompt = null;
    }
    updateInstallRow();
  }
});

// ===== 3. 没网时的提示 =====

function updateOfflineBanner() {
  let banner = document.getElementById('offline-banner');
  if (navigator.onLine) {
    if (banner) {
      banner.hidden = true;
    }
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.className = 'offline-banner';
    banner.textContent = 'You’re offline. Your classes and walking times still work; the map background and address search need internet.';
    document.body.prepend(banner);
  }
  banner.hidden = false;
}

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('load', updateOfflineBanner);

console.log('pwa.js loaded');
