#!/usr/bin/env python3
"""
앱 스토어용 이미지를 만든다.

규격 참고 (World App 제출용):
  hero        : 세로형. 전체 화면 캡처를 그대로 쓰되 너무 길면 상단만 자른다.
  meta_tag    : 1200x630 (16:9 OG 이미지). 모바일 캡처를 그대로 넣으면
                화면이 postage-stamp 처 보이므로, 브랜드 띠를 얹어landscape 로 만든다.
  showcase    : 세로형 스크린샷 (1장)

출력은 app/public/store/ 에 넣고, push 하면 Pages 가 곧바로 배포해
https://inheritance.pages.dev/store/<name>.png 로 공개 URL 이 생긴다.
MCP upload_app_image 은 source_url 을 받으므로 base64 를 컨텍스트에 흘리지 않는다.
"""
import pathlib
from PIL import Image, ImageDraw, ImageFont

SRC = pathlib.Path("/tmp/qa/store")
DST = pathlib.Path("/home/davis/world-inheritance-miniapp/app/public/store")
DST.mkdir(parents=True, exist_ok=True)

BG = (248, 250, 252)
INK = (15, 23, 42)
MUTED = (71, 85, 105)
ACCENT = (2, 132, 199)
CARD = (255, 255, 255)


def font(size, bold=False):
    for name in (
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else ""),
    ):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def rounded(img, radius):
    """모서리를 둥글게 깎는다 (알파)."""
    from PIL import ImageDraw
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


# ---------------------------------------------------------------- hero
hero_src = Image.open(SRC / "hero.png").convert("RGB")
# 스토어 목록에서 잘리지 않도록 세로 길이를 정리 (긴 캡처는 하단을 자른다)
max_h = 1600
if hero_src.height > max_h:
    hero_src = hero_src.crop((0, 0, hero_src.width, max_h))
hero = rounded(hero_src, 28)
hero.save(DST / "hero.png", optimize=True)
print(f"hero.png          {hero.size}")

# ------------------------------------------------------- showcase (세로)
show = Image.open(SRC / "showcase-timer.png").convert("RGB")
show = rounded(show, 24)
show.save(DST / "showcase_1.png", optimize=True)
print(f"showcase_1.png    {show.size}")

# ------------------------------------------------------------ meta tag
W, H = 1200, 630
meta = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(meta)

# 왼쪽: 텍스트
d.rectangle([0, 0, 8, H], fill=ACCENT)
d.text((72, 132), "Inheritance", font=font(64, True), fill=INK)
d.text((72, 224), "A time-based WLD", font=font(34), fill=MUTED)
d.text((72, 270), "inheritance vault", font=font(34), fill=MUTED)

facts = [
    ("Non-custodial", "keys stay in World App"),
    ("On-chain", "World Chain, verified contracts"),
    ("Countdown", "renew, or the heir can claim"),
]
y = 360
for k, v in facts:
    d.ellipse([72, y + 9, 84, y + 21], fill=ACCENT)
    d.text((100, y), k, font=font(24, True), fill=INK)
    d.text((100, y + 32), v, font=font(20), fill=MUTED)
    y += 84

# 오른쪽: 실제 앱 화면
thumb = Image.open(SRC / "hero.png").convert("RGB")
scale = 560 / thumb.height
thumb = thumb.resize((max(1, int(thumb.width * scale)), 560), Image.LANCZOS)
thumb = rounded(thumb, 18)
shadow = Image.new("RGBA", (thumb.width + 40, thumb.height + 40), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    [20, 24, shadow.width - 20, shadow.height - 16], 18, fill=(15, 23, 42, 38)
)
meta.paste(shadow, (W - thumb.width - 120, 35), shadow)
meta.paste(thumb, (W - thumb.width - 100, 15), thumb)

d.text((72, H - 56), "inheritance.pages.dev", font=font(18), fill=MUTED)
meta.save(DST / "meta_tag.png", optimize=True)
print(f"meta_tag.png      {meta.size}")

# ------------------------------------------------------------------ logo
icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
di = ImageDraw.Draw(icon)
di.rounded_rectangle([0, 0, 511, 511], 112, fill=INK)
di.polygon([(256, 96), (416, 176), (416, 336), (256, 416), (96, 336), (96, 176)], outline=ACCENT, width=22)
di.ellipse([228, 228, 284, 284], fill=ACCENT)
icon.resize((512, 512), Image.LANCZOS).save(DST / "logo.png", optimize=True)
print(f"logo.png          (512, 512)")

for p in sorted(DST.glob("*.png")):
    print(f"  {p.name:20} {p.stat().st_size/1024:7.1f} KB")
