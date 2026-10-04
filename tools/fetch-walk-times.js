// tools/fetch-walk-times.js：一次性工具脚本，不属于网页本身
// 作用：用 OpenRouteService 的 Matrix 服务，算出 data.json 里所有地点两两之间的真实步行时间和距离，
//       保存到 walk-times.json。网页之后直接查这张表，不需要再调用任何服务，也不需要 key
// 运行方法（在 bu-dorm-distance 文件夹里）：
//   node tools/fetch-walk-times.js        只算新加的地点（原来的时间一个都不变，网站上已有的数字不会跳）
//   node tools/fetch-walk-times.js --all  全部重新算（改了已有地点的坐标之后用）
// 什么时候需要重新运行：data.json 里加了新地点、或者改了坐标之后

const fs = require('fs');

// 从 .env 读取 key（.env 已经写进 .gitignore，不会被上传）
process.loadEnvFile('.env');
const API_KEY = process.env.ORS_API_KEY;
if (!API_KEY) {
  console.log('No ORS_API_KEY found in .env');
  process.exit(1);
}

const MATRIX_URL = 'https://api.openrouteservice.org/v2/matrix/foot-walking';
const MAX_CELLS_PER_REQUEST = 3500; // 免费版：一次请求最多算 3500 个格子（起点数 × 终点数）

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// 算一批起点到一批终点的时间和距离
// 输入：所有地点的坐标、这一批起点在数组里的位置、终点在数组里的位置（不写就是所有地点）
// 输出：{ durations: [[秒]], distances: [[米]] }，每行对应一个起点，每列对应一个终点
async function fetchMatrix(locations, sourceIndexes, destinationIndexes) {
  const response = await fetch(MATRIX_URL, {
    method: 'POST',
    headers: {
      'Authorization': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      locations: locations,       // 注意：OpenRouteService 要求 [经度, 纬度] 的顺序，和 Leaflet 相反
      sources: sourceIndexes,     // 这一批的起点
      destinations: destinationIndexes, // 不写（undefined）时 JSON 里就没有这一项 = 所有地点
      metrics: ['duration', 'distance'],
      units: 'm'
    })
  });

  if (!response.ok) {
    // 把服务器返回的错误说明打印出来，方便排查（里面不会包含 key）
    throw new Error('HTTP ' + response.status + ': ' + (await response.text()));
  }
  return response.json();
}

// 秒和米都取整；走不通的路线服务会返回 null，原样保留
function roundRow(row) {
  return row.map(function (v) { return v === null ? null : Math.round(v); });
}

// 把 sources 按批切开：每批 起点数 × 终点数 不超过 3500
function batches(indexes, destinationCount) {
  const size = Math.max(1, Math.floor(MAX_CELLS_PER_REQUEST / destinationCount));
  const out = [];
  for (let i = 0; i < indexes.length; i += size) {
    out.push(indexes.slice(i, i + size));
  }
  return out;
}

async function main() {
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const places = data.dorms.concat(data.buildings);

  const ids = places.map(function (p) { return p.id; });
  // 有 entrance（入口坐标）的地点，用入口算路线；没有的用地图上的点
  // 原因：路线服务会把点"吸附"到最近的路上，楼中间的点可能被吸到楼另一侧不相通的小路上
  const locations = places.map(function (p) {
    if (p.entrance) {
      return [p.entrance[1], p.entrance[0]]; // entrance 是 [纬度, 经度]，这里要换成 [经度, 纬度]
    }
    return [p.longitude, p.latitude];
  });
  const all = ids.map(function (id, i) { return i; });

  // 原来的表：默认只补新地点，原来两两之间的时间保留不动
  let old = null;
  if (!process.argv.includes('--all') && fs.existsSync('walk-times.json')) {
    old = JSON.parse(fs.readFileSync('walk-times.json', 'utf8'));
  }
  const oldIndex = {};
  if (old) {
    old.ids.forEach(function (id, i) { oldIndex[id] = i; });
  }
  const isNew = function (i) { return oldIndex[ids[i]] === undefined; };
  const newIndexes = all.filter(isNew);
  const oldIndexes = all.filter(function (i) { return !isNew(i); });

  if (old && newIndexes.length === 0) {
    console.log('no new places: walk-times.json is already up to date (use --all to recompute everything)');
    return;
  }

  // 先把整张表铺好：两头都是原来的地点 → 直接用原来的数；其他先空着
  const seconds = all.map(function (i) {
    return all.map(function (j) {
      return isNew(i) || isNew(j) ? undefined : old.seconds[oldIndex[ids[i]]][oldIndex[ids[j]]];
    });
  });
  const meters = all.map(function (i) {
    return all.map(function (j) {
      return isNew(i) || isNew(j) ? undefined : old.meters[oldIndex[ids[i]]][oldIndex[ids[j]]];
    });
  });

  // 要算的：新地点 → 所有地点（整行）；原来的地点 → 新地点（新的那几列）
  // 全部重算时（没有 old），newIndexes 就是所有地点，第二步没有要算的
  const jobs = [];
  batches(newIndexes, all.length).forEach(function (rows) {
    jobs.push({ sources: rows, destinations: undefined, columns: all });
  });
  if (oldIndexes.length > 0) {
    batches(oldIndexes, newIndexes.length).forEach(function (rows) {
      jobs.push({ sources: rows, destinations: newIndexes, columns: newIndexes });
    });
  }

  for (let k = 0; k < jobs.length; k++) {
    const job = jobs[k];
    console.log(`request ${k + 1} of ${jobs.length}: ${job.sources.length} × ${job.columns.length} routes...`);
    const result = await fetchMatrix(locations, job.sources, job.destinations);
    job.sources.forEach(function (i, r) {
      const durations = roundRow(result.durations[r]);
      const distances = roundRow(result.distances[r]);
      job.columns.forEach(function (j, c) {
        seconds[i][j] = durations[c];
        meters[i][j] = distances[c];
      });
    });
    await wait(2000); // 免费版每分钟最多 40 次，分批时稍微等一下
  }

  const output = {
    source: 'OpenRouteService foot-walking matrix',
    generated: new Date().toISOString().slice(0, 10),
    ids: ids,
    seconds: seconds,
    meters: meters
  };
  fs.writeFileSync('walk-times.json', JSON.stringify(output));

  const missing = seconds.flat().filter(function (v) { return v === null || v === undefined; }).length;
  console.log(`done: ${places.length} × ${places.length} walking times saved to walk-times.json` +
    (old ? ` (${newIndexes.length} new places added, existing times kept)` : '') +
    (missing ? ` (${missing} routes not found)` : ''));
}

main().catch(function (error) {
  console.log('failed:', error.message);
  process.exit(1);
});
