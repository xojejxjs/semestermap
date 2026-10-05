# tools/make-share-images.py：一次性工具脚本，不属于网页本身
# 作用：生成网站图标（favicon-32.png、apple-touch-icon.png、icon-192/512、icon-maskable-512）和分享预览图（og-image.png）
#       分享预览图：把网址发到微信、iMessage、Slack 时，出现的那张带图的卡片
# 运行方法（在 bu-dorm-distance 文件夹里）：python3 tools/make-share-images.py   （需要 Pillow：pip install pillow）
# 什么时候需要重新运行：网站的名字、颜色、主要功能变了以后
from PIL import Image, ImageDraw, ImageFont
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')  # 图片放在项目根目录
RED = (204, 0, 0); NAVY = (26, 31, 113); BLUE = (74, 157, 255); INK = (31, 41, 55); MUTED = (107, 114, 128)
GREEN = (30, 142, 62); AMBER = (232, 162, 0); LATE = (198, 40, 40)

def font(size, bold=False):
    path = '/System/Library/Fonts/HelveticaNeue.ttc'
    return ImageFont.truetype(path, size, index=1 if bold else 0)

# ===== 图标：一笔写成的 "ML"（作者名字的缩写），同时是一条步行路线 =====
# M 的右腿就是 L 的竖：一条路线写完两个字母。左下空心圈 = 出发，中间两个小点 = 两节课，右边绿点 = 准时到达
ICON_RED_TOP, ICON_RED_BOT = (236, 56, 56), (196, 28, 40)
ICON_GREEN = (46, 213, 115)
ML_POINTS = [(205, 790), (205, 250), (395, 560), (585, 250), (585, 790), (830, 790)]  # 1024 x 1024 画布上的坐标

def _smooth(pts, r):
    # 转角用二次贝塞尔曲线做成圆弧：更像真实的走路路线（人不会走直角）
    import math
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[i + 1]
        def toward(ax, ay, bx, by, dist):
            L = math.hypot(bx - ax, by - ay); t = min(dist / L, 0.5)
            return ax + (bx - ax) * t, ay + (by - ay) * t
        a = toward(x1, y1, x0, y0, r); b = toward(x1, y1, x2, y2, r)
        out.append(a)
        for k in range(1, 16):
            t = k / 16
            out.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * x1 + t * t * b[0],
                        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * y1 + t * t * b[1]))
        out.append(b)
    out.append(pts[-1]); return out

def _draw_ml(d, scale, offset):
    # 在 1024 的设计稿上画，再按 scale 缩放、offset 平移（可裁剪版图标要缩小放在中间）
    def P(x, y):
        return (x * scale + offset, y * scale + offset)
    def dot(x, y, r, c):
        cx, cy = P(x, y); rr = r * scale
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=c)
    pts = _smooth(ML_POINTS, 85)
    d.line([P(x, y) for x, y in pts], fill='white', width=int(84 * scale), joint='curve')
    for x, y in pts:
        dot(x, y, 42, 'white')
    x, y = ML_POINTS[0]; dot(x, y, 76, 'white'); dot(x, y, 40, ICON_RED_TOP)       # 起点：空心圈
    for x, y in (ML_POINTS[2], ML_POINTS[4]):
        dot(x, y, 20, ICON_RED_BOT)                                                 # 两节课：线上的小点
    x, y = ML_POINTS[-1]; dot(x, y, 92, ICON_GREEN); dot(x, y, 34, 'white')         # 终点：绿色 = 准时到

def _red_background(s):
    img = Image.new('RGBA', (s, s)); d = ImageDraw.Draw(img)
    for y in range(s):
        t = y / (s - 1)
        d.line([(0, y), (s, y)], fill=tuple(int(ICON_RED_TOP[i] + (ICON_RED_BOT[i] - ICON_RED_TOP[i]) * t) for i in range(3)) + (255,))
    return img

def icon(size):
    # 圆角方块（iPhone、浏览器标签页、分享图上用）
    s = 1024
    img = _red_background(s)
    _draw_ml(ImageDraw.Draw(img), 1, 0)
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.2237), fill=255)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0)); out.paste(img, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)

icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(32).save(os.path.join(OUT, 'favicon-32.png'))

# 加到手机主屏幕用的图标（manifest.json）
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))

def maskable(size):
    # Android 会把图标裁成圆形、圆角方块等形状：红色铺满整张图，ML 缩小到 76% 放在中间的安全区里
    s = 1024
    img = _red_background(s)
    k = 0.76
    _draw_ml(ImageDraw.Draw(img), k, s * (1 - k) / 2)
    return img.resize((size, size), Image.LANCZOS)

maskable(512).save(os.path.join(OUT, 'icon-maskable-512.png'))

# 分享预览图 1200×630：左边名字和三件事，右边一张示意小地图
W, H = 1200, 630
img = Image.new('RGB', (W, H), 'white')
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W, 10], fill=RED)
img.paste(icon(88), (70, 80), icon(88))
d.text((175, 88), 'WalkMyWeek', font=font(64, True), fill=RED)
d.text((72, 210), 'Your week on a map', font=font(40, True), fill=INK)
lines = ['See where your classes are', 'Check if you can make it between classes', 'Find a dorm close to your classes']
for i, t in enumerate(lines):
    y = 290 + i * 62
    d.ellipse([74, y + 10, 90, y + 26], fill=NAVY)
    d.text((108, y), t, font=font(30), fill=INK)
d.text((72, 520), 'Free · no sign-up · files stay in your browser', font=font(24), fill=MUTED)

# 右边的示意地图（不是真实地图，只表示网站长什么样）
mx, my, mw, mh = 720, 60, 420, 510
d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=24, fill=(242, 239, 233), outline=(225, 220, 210), width=2)
d.line([(mx, my + 300), (mx + mw, my + 230)], fill=(250, 200, 120), width=26)   # 一条大路
d.line([(mx + 150, my), (mx + 230, my + mh)], fill=(255, 255, 255), width=14)
d.rectangle([mx + 50, my + 110, mx + 150, my + 170], fill=(205, 205, 225), outline=NAVY, width=4)
d.rectangle([mx + 270, my + 330, mx + 360, my + 400], fill=(205, 205, 225), outline=NAVY, width=4)
d.line([(mx + 100, my + 170), (mx + 140, my + 250), (mx + 260, my + 290), (mx + 315, my + 330)], fill=(21, 88, 192), width=14, joint='curve')
d.line([(mx + 100, my + 170), (mx + 140, my + 250), (mx + 260, my + 290), (mx + 315, my + 330)], fill=BLUE, width=8, joint='curve')
def pill(x, y, text, role):
    f = font(22, True); fr = font(15, True)
    tw = d.textlength(text, font=f); rw = d.textlength(role, font=fr) + 14
    w = tw + rw + 30
    d.rounded_rectangle([x, y, x + w, y + 40], radius=20, fill=NAVY, outline='white', width=3)
    d.rounded_rectangle([x + 10, y + 10, x + 10 + rw, y + 30], radius=10, fill='white')
    d.text((x + 17, y + 12), role, font=fr, fill=NAVY)
    d.text((x + 20 + rw, y + 8), text, font=f, fill='white')
pill(mx + 30, my + 50, 'CAS · 3 classes', 'FROM')
pill(mx + 190, my + 410, 'SHA · 1 class', 'TO')
d.rounded_rectangle([mx + 30, my + mh - 52, mx + 290, my + mh - 14], radius=19, fill=(253, 232, 232))
d.ellipse([mx + 44, my + mh - 43, mx + 64, my + mh - 23], fill=LATE)
d.text((mx + 74, my + mh - 46), '18 min walk · 3 min late', font=font(20, True), fill=LATE)
img.save(os.path.join(OUT, 'og-image.png'), optimize=True)
print('done')
