// pwa.js：加到手机主屏幕 + 没网时也能打开
//
// 1. 注册 Service Worker（sw.js）；网址带 ?nosw 时反过来：注销它、清掉缓存（单台设备的"一键关闭"）
// 2. 页面右上角的 "📲 Get the app"：能直接装就直接装，不能的话一步一步教（iPhone Safari、微信里）
// 3. 没网时最上面一条小提示：哪些功能还能用

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

// ===== 2. "📲 Get the app" 按钮（页面右上角，每一页都看得到） =====
// 不同手机、不同浏览器，加到主屏幕的方法不一样：
//   Chrome（Android / 电脑）允许时：点按钮直接弹出安装
//   iPhone Safari：苹果不允许网页直接安装 → 弹出一步一步的说明（Share → Add to Home Screen）
//   微信里：微信浏览器不能加到主屏幕 → 先教用户在 Safari / 浏览器里打开
//   已经是从主屏幕打开的：不显示按钮

// 已经是从主屏幕打开的（像 App 一样全屏）
function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function devicePlatform() {
  const ua = navigator.userAgent;
  const android = /Android/.test(ua);
  // iPad 新系统会假装是 Mac：靠"能触摸"认出来（已经认出是 Android 的不算）
  const ios = /iPhone|iPad|iPod/.test(ua) || (!android && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    ios: ios,
    android: android,
    wechat: /MicroMessenger/i.test(ua),
    iosOtherBrowser: ios && /CriOS|FxiOS|EdgiOS/.test(ua) // iPhone 上的 Chrome、Firefox、Edge：分享按钮在地址栏
  };
}

// iPhone 分享按钮的样子（方框 + 向上的箭头），画在说明里，用户一看就知道找哪个
const SHARE_ICON = '<svg class="share-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// 这台设备要怎么加；不能加（比如电脑上的 Safari）时返回 null
function installSteps() {
  const p = devicePlatform();
  if (p.wechat) {
    return {
      title: 'Open <span translate="no">WalkMyWeek</span> in your browser first',
      note: '<span translate="no">WeChat</span> can’t add websites to your Home Screen.',
      steps: ['Tap <strong>···</strong> at the top right',
        p.ios ? 'Choose <strong>Open in <span translate="no">Safari</span></strong>' : 'Choose <strong>Open in browser</strong>',
        'Tap <strong>📲 Get the app</strong> again there']
    };
  }
  if (p.ios && p.iosOtherBrowser) {
    return {
      title: 'Add <span translate="no">WalkMyWeek</span> to your Home Screen',
      steps: [`Tap the <strong>Share</strong> button ${SHARE_ICON} in the address bar`,
        'Choose <strong>Add to Home Screen</strong>', 'Tap <strong>Add</strong>']
    };
  }
  if (p.ios) {
    return {
      title: 'Add <span translate="no">WalkMyWeek</span> to your Home Screen',
      steps: [`Tap the <strong>Share</strong> button ${SHARE_ICON} in <span translate="no">Safari</span>’s toolbar`,
        'Scroll down and choose <strong>Add to Home Screen</strong>', 'Tap <strong>Add</strong>']
    };
  }
  if (p.android) {
    return {
      title: 'Install <span translate="no">WalkMyWeek</span>',
      steps: ['Tap the <strong>⋮</strong> menu at the top right',
        'Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>']
    };
  }
  return null;
}

// 按钮显不显示：没装过，并且（浏览器能直接装，或者我们能教怎么装）
function updateInstallCta() {
  const button = document.getElementById('install-cta');
  if (!button) {
    return;
  }
  button.hidden = isInstalledApp() || !(installPrompt || installSteps());
}

// 一步一步的说明：显示在标题下面，可以关掉
function toggleInstallSheet() {
  const sheet = document.getElementById('install-sheet');
  if (!sheet.hidden) {
    sheet.hidden = true;
    return;
  }
  const info = installSteps();
  if (!info) {
    return;
  }
  sheet.innerHTML = `<div class="install-sheet-head"><strong>${info.title}</strong>` +
    '<button type="button" class="install-sheet-close" data-install="close" aria-label="Close">✕</button></div>' +
    (info.note ? `<p class="hint">${info.note}</p>` : '') +
    '<ol class="install-steps">' + info.steps.map(function (step) { return `<li>${step}</li>`; }).join('') + '</ol>' +
    '<p class="hint">It opens full screen like an app, and your classes work even without internet.</p>';
  sheet.hidden = false;
  logEvent('install-steps-open');
}

// Chrome 觉得可以安装时会发这个事件：先存着，等用户自己点按钮
window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  installPrompt = event;
  updateInstallCta();
});

window.addEventListener('appinstalled', function () {
  installPrompt = null;
  logEvent('pwa-installed');
  updateInstallCta();
  document.getElementById('install-sheet').hidden = true;
});

document.addEventListener('click', async function (event) {
  if (event.target.closest('[data-install="close"]')) {
    document.getElementById('install-sheet').hidden = true;
    return;
  }
  if (!event.target.closest('#install-cta')) {
    return;
  }
  logEvent('install-cta');
  // 浏览器能直接装：直接弹出安装；否则显示说明
  if (installPrompt) {
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      installPrompt = null;
    }
    updateInstallCta();
    return;
  }
  toggleInstallSheet();
});

updateInstallCta();

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
