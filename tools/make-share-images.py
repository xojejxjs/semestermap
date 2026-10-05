# tools/make-share-images.py：一次性工具脚本，不属于网页本身
# 作用：生成网站图标（favicon-32.png、apple-touch-icon.png）和分享预览图（og-image.png）
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

def icon(size):
    # 红色圆角方块 + 白色定位针（中间一个红点）
    s = size * 4  # 先画大图再缩小，边缘更平滑
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=RED)
    cx, top, r = s / 2, s * 0.18, s * 0.24
    d.ellipse([cx - r, top, cx + r, top + 2 * r], fill='white')
    d.polygon([(cx - r * 0.82, top + r * 1.45), (cx + r * 0.82, top + r * 1.45), (cx, s * 0.84)], fill='white')
    d.ellipse([cx - r * 0.42, top + r * 0.58, cx + r * 0.42, top + r * 1.42], fill=RED)
    return img.resize((size, size), Image.LANCZOS)

icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(32).save(os.path.join(OUT, 'favicon-32.png'))

# 加到手机主屏幕用的图标（manifest.json）
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))

def maskable(size):
    # Android 会把图标裁成圆形、圆角方块等形状：底色铺满整张图，定位针缩小放在中间的安全区（中间 80%）里
    s = size * 4
    img = Image.new('RGBA', (s, s), RED)
    d = ImageDraw.Draw(img)
    k = 0.72                      # 定位针缩小到 72%，保证在安全区里
    o = s * (1 - k) / 2           # 居中
    cx, top, r = s / 2, o + s * k * 0.18, s * k * 0.24
    d.ellipse([cx - r, top, cx + r, top + 2 * r], fill='white')
    d.polygon([(cx - r * 0.82, top + r * 1.45), (cx + r * 0.82, top + r * 1.45), (cx, o + s * k * 0.84)], fill='white')
    d.ellipse([cx - r * 0.42, top + r * 0.58, cx + r * 0.42, top + r * 1.42], fill=RED)
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
