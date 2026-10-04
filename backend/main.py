# backend/main.py：BU Dorm Dash 的后端
# 作用：保管 OpenRouteService 的 API key，替浏览器计算真实步行路线
# 运行方法（在 bu-dorm-distance 文件夹里）：
#   backend/.venv/bin/uvicorn backend.main:app --reload --port 8001

import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# 关掉 uvicorn 的访问日志：它会把每个请求的完整网址（包括起点终点的经纬度，可能是用户现在的位置）
# 打印出来，托管平台会把这些日志存下来。我们不需要这些记录，所以不记
# 错误日志（uvicorn.error）照常保留，出问题时还能排查
logging.getLogger("uvicorn.access").disabled = True

# 创建后端应用。title 会显示在自动生成的接口说明页面（/docs）上
app = FastAPI(title="BU Dorm Dash API")

# CORS：告诉浏览器"这几个网站可以读取我返回的数据"
# 网页（localhost:8000）和后端（localhost:8001）端口不同，浏览器会当成两个网站，默认不允许互相读取
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",       # 本地开发
        "http://127.0.0.1:8000",
        "https://xojejxjs.github.io",  # 线上网站（以后后端部署上线后用）
    ],
    allow_methods=["GET"],  # 我们的接口都是 GET，只开放需要的
)


# ===== 读取 API key =====

def load_env_file(path):
    """把 .env 文件里的 KEY=VALUE 读进环境变量（已经存在的环境变量优先，不会被覆盖）"""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


# .env 在项目根目录（backend 文件夹的上一层）
load_env_file(Path(__file__).resolve().parent.parent / ".env")
ORS_API_KEY = os.environ.get("ORS_API_KEY")

ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson"

# 只接受 BU 周边的坐标，免得别人拿我们的后端去算别的城市，把每天的额度用光
BOSTON_BOUNDS = {"min_lat": 42.30, "max_lat": 42.40, "min_lng": -71.20, "max_lng": -71.00}

# 查过的路线记在这里：key 是四个坐标（保留 5 位小数，约 1 米），value 是结果
route_cache = {}


# ===== 接口 =====

# @app.get(...) 叫"装饰器"：意思是"有人用 GET 方式访问 /api/health 时，执行下面这个函数"
# 函数返回的字典，FastAPI 会自动转成 JSON 发回给浏览器
@app.get("/api/health")
def health():
    return {"status": "ok", "has_api_key": ORS_API_KEY is not None}


# 计算两点之间的真实步行路线
# 参数写成 float 类型：FastAPI 会自动检查，不是数字就直接返回错误，不会进到函数里
@app.get("/api/route")
def route(
    from_lat: float = Query(description="起点纬度"),
    from_lng: float = Query(description="起点经度"),
    to_lat: float = Query(description="终点纬度"),
    to_lng: float = Query(description="终点经度"),
):
    # 1. 没有 key：说明 .env 没放好
    if not ORS_API_KEY:
        raise HTTPException(status_code=500, detail="ORS_API_KEY is not set on the server")

    # 2. 坐标不在 BU 周边：拒绝（HTTP 400 表示"请求本身有问题"）
    for lat, lng in [(from_lat, from_lng), (to_lat, to_lng)]:
        if not (BOSTON_BOUNDS["min_lat"] <= lat <= BOSTON_BOUNDS["max_lat"]
                and BOSTON_BOUNDS["min_lng"] <= lng <= BOSTON_BOUNDS["max_lng"]):
            raise HTTPException(status_code=400, detail="Only places near Boston University are supported")

    # 3. 查过的直接返回
    cache_key = tuple(round(v, 5) for v in (from_lat, from_lng, to_lat, to_lng))
    if cache_key in route_cache:
        return route_cache[cache_key]

    # 4. 问 OpenRouteService。注意它要的是 [经度, 纬度]，和我们平时的顺序相反
    body = json.dumps({"coordinates": [[from_lng, from_lat], [to_lng, to_lat]]}).encode()
    request = urllib.request.Request(
        ORS_DIRECTIONS_URL,
        data=body,  # 有 data 就是 POST 请求
        headers={"Authorization": ORS_API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # 路线服务返回了错误（比如额度用完、两点之间走不通）：HTTP 502 表示"我依赖的上游服务出错了"
        raise HTTPException(status_code=502, detail=f"Routing service error ({error.code})")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=502, detail="Routing service unreachable")

    # 5. 整理成前端好用的格式
    feature = result["features"][0]
    summary = feature["properties"]["summary"]
    output = {
        "meters": round(summary.get("distance", 0)),
        "seconds": round(summary.get("duration", 0)),
        # 路线上的每个点，换回 [纬度, 经度]，Leaflet 可以直接用来画线
        "path": [[round(lat, 6), round(lng, 6)] for lng, lat in feature["geometry"]["coordinates"]],
    }
    route_cache[cache_key] = output
    return output
