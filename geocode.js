// geocode.js：只负责"把地址变成经纬度"（地理编码 geocoding）
// 用的是 OpenStreetMap 的免费服务 Nominatim。使用规则：每秒最多查 1 次、不能边打字边查
// 所以只在用户打完字时才查，并且查过的地址会记住，不再重复查询

const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

// 只在波士顿周边找（西, 北, 东, 南），避免输入 "1 Main St" 找到别的城市
const BOSTON_VIEWBOX = '-71.20,42.40,-71.00,42.30';

// 查过的地址：key 是小写的地址文字，value 是 { latitude, longitude, label }，找不到时是 null
const geocodeCache = {};

// 把地址变成经纬度
// 输入：用户输入的地址文字
// 输出：{ latitude, longitude, label }；找不到时是 null
async function geocodeAddress(text) {
  const key = text.trim().toLowerCase();
  if (key in geocodeCache) {
    return geocodeCache[key];
  }

  const params = new URLSearchParams({
    q: text,
    format: 'json',
    limit: '1',
    viewbox: BOSTON_VIEWBOX,
    bounded: '1' // 只返回 viewbox 范围里的结果
  });

  try {
    const response = await fetch(GEOCODE_URL + '?' + params);
    if (!response.ok) {
      return null; // 服务器出错：不记进缓存，下次还可以再试
    }
    const results = await response.json();

    let found = null;
    if (results.length > 0) {
      found = {
        latitude: Number(results[0].lat),
        longitude: Number(results[0].lon),
        // display_name 很长（"1200, Commonwealth Avenue, Allston, Boston, ..."），只留前两段
        label: results[0].display_name.split(',').slice(0, 2).join(','),
        // 地图上这个地方的名字（比如 "Physics and Biology Research Building"）；没有名字时是空的
        name: results[0].name || ''
      };
    }
    geocodeCache[key] = found; // 找到和确定找不到，都记下来
    return found;
  } catch (error) {
    return null; // 网络出错：同样不记，下次再试
  }
}

// 找一个地方：地址，也可以是店名、地名（"Starbucks"、"Target"、"Blick Art Materials"）
// 和 geocodeAddress 的区别：多要几个结果，挑离参考点最近的那个
// （"Starbucks" 波士顿有很多家，要的是最顺路的一家）
// 输入：文字、参考点：一个 { latitude, longitude }，或者几个（课间规划传两节课的楼：挑"两段路加起来最短"的）
// 输出：{ latitude, longitude, label, name }；找不到时是 null
const placeSearchCache = {};

// 先在校园周边找（大约 2 公里内），找不到再扩大到整个波士顿
// 原因：店名在全城有很多家时，服务只返回前几个结果，校园旁边那家可能不在里面
const CAMPUS_VIEWBOX = '-71.140,42.365,-71.070,42.335';

async function searchPlaces(text, viewbox) {
  const params = new URLSearchParams({ q: text, format: 'json', limit: '10', viewbox: viewbox, bounded: '1' });
  const response = await fetch(GEOCODE_URL + '?' + params);
  if (!response.ok) {
    throw new Error('search failed');
  }
  return response.json();
}

async function geocodePlaceNear(text, near) {
  const key = text.trim().toLowerCase();
  let results = placeSearchCache[key];
  if (!results) {
    try {
      results = await searchPlaces(text, CAMPUS_VIEWBOX);
      if (results.length === 0) {
        results = await searchPlaces(text, BOSTON_VIEWBOX);
      }
      placeSearchCache[key] = results;
    } catch (error) {
      return null; // 网络出错：不记进缓存，下次再试
    }
  }
  if (results.length === 0) {
    return null;
  }
  // 粗略的距离就够比较远近了（1 度纬度 ≈ 111 km，这里 1 度经度 ≈ 82 km）
  const refs = Array.isArray(near) ? near : [near];
  const distance = function (r) {
    return refs.reduce(function (total, p) {
      return total + Math.hypot((Number(r.lat) - p.latitude) * 111, (Number(r.lon) - p.longitude) * 82);
    }, 0);
  };
  const best = results.slice().sort(function (a, b) { return distance(a) - distance(b); })[0];
  const parts = best.display_name.split(',').map(function (x) { return x.trim(); });
  return {
    latitude: Number(best.lat),
    longitude: Number(best.lon),
    name: best.name || parts[0],
    // 名字 + 门牌和街道，比如 "Starbucks, 700 Commonwealth Avenue"
    label: best.name && parts[0] === best.name ? [parts[0], parts.slice(1, 3).join(' ')].join(', ') : parts.slice(0, 2).join(', ')
  };
}

// 用户把大头针拖到了新位置：更新记住的坐标，之后再算这个地址就用新位置
function adjustGeocode(text, latitude, longitude) {
  const key = text.trim().toLowerCase();
  if (geocodeCache[key]) {
    geocodeCache[key].latitude = latitude;
    geocodeCache[key].longitude = longitude;
  }
}

console.log('geocode.js loaded');
