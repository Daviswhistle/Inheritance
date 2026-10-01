#!/usr/bin/env python3
"""
앱 스토어용 이미지를 만든다.

입력: `scripts/verify/store-shots.mjs` 가 만든 원본 캡처 (scripts/verify/ 가 체인·브라우저를
직접 구동해 찍는다). 예전처럼 `/tmp/qa/store` 에 손으로 모아 둔 파일을 쓰지 않는다 —
그러면 **앱이 바뀌어도 이미지는 옛 화면 그대로 남는다.** 실제로 그렇게 됐고,
"After expiry the balance … cannot be recovered" 라는 **앱이 보장하지 않는 설명**이
리뷰어에게 그대로 제출됐다.

원본 캡처 경로:
  RAW = /tmp/wld-verify/shots/store-*.png   (store-shots.mjs 가 만든다)

규격:
  hero        : 세로. 스토어 목록에서 잘리지 않게 상단만 자른다.
  showcase_N  : 세로 스크린샷. 1장 이상 필요.
  content_card: 미니앱 필수. 세로, 카드용으로 조금 더 짧게.
  meta_tag    : 1200x630 (16:9 OG 이미지).

주의: 여기서 **문구를 덧씌우지 않는다.** 캡처에 보이는 문장이 곧 앱이 말하는 문장이어야
한다. 이미지 도구로 "더 좋은 설명"을 입히는 순간, 스토어가 앱과 다른 약속을 하게 된다.
"""
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

REPO = pathlib.Path(__file__).resolve().parent.parent
RAW = pathlib.Path("/tmp/wld-verify/shots")
DST = REPO / "app/public/store"
DST.mkdir(parents=True, exist_ok=True)

BG = (248, 250, 252)
INK = (15, 23, 42)
MUTED = (71, 85, 105)
ACCENT = (2, 132, 199)


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
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def load(name):
    p = RAW / f"{name}.png"
    if not p.exists():
        print(f"원본 없음: {p}", file=sys.stderr)
        print("먼저 `FACTORY=... node scripts/verify/store-shots.mjs` 를 돌린다.", file=sys.stderr)
        sys.exit(2)
    return Image.open(p).convert("RGB")


def cap_h(img, max_h):
    """세로 길이만 제한한다. 가로는 그대로 (스토어는 세로 카드다)."""
    return img.crop((0, 0, img.width, min(img.height, max_h))) if img.height > max_h else img


# ---------------------------------------------------------------- hero
hero = rounded(cap_h(load("store-2-countdown"), 1600), 28)
hero.save(DST / "hero.png", optimize=True)
print(f"hero.png          {hero.size}")

# ---------------------------------------------------------------- showcase
# 파이프라인("지금 여기")과 상속인 전달 카드가 같이 보이는 화면. 이 앱의 값 설명이
# 가장 온전히 들어 있는 한 장이다.
# 하단을 잘라야 한다. 캡처를 그대로 두면 "Copy link" 아래의 상속인 링크가 **주소 중간에서
# 잘린 채** 스토어에 오른다 — 반쪽 주소는 사람이 만든 티가 나고, 잘린 텍스트는 화면이
# 깨진 것보다 나쁘다. "Copy link / Copy message" 버튼 아래 여백에서 자른다.
show = rounded(cap_h(load("store-3-steps"), 1540), 24)
show.save(DST / "showcase_1.png", optimize=True)
print(f"showcase_1.png    {show.size}")

# 두 번째 showcase: 첫 진입 화면. "무엇을 하는 앱인지" 를 처음 보는 사람이 보는 얼굴.
show2 = rounded(cap_h(load("store-1-create"), 1700), 24)
show2.save(DST / "showcase_2.png", optimize=True)
print(f"showcase_2.png    {show2.size}")

# ---------------------------------------------------------------- content card
# 미니앱 필수 이미지. 스토어 카드에 작게 뜨므로 세로로 길면 글자가 못 읽힌다.
cc = cap_h(load("store-2-countdown"), 1200)
cc = rounded(cc, 24)
cc.save(DST / "content_card.png", optimize=True)
print(f"content_card.png  {cc.size}")

# ---------------------------------------------------------------- meta tag
W, H = 1200, 630
meta = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(meta)
d.rectangle([0, 0, 8, H], fill=ACCENT)
d.text((72, 112), "Inheritance", font=font(62, True), fill=INK)
d.text((72, 202), "A WLD vault that goes to", font=font(31), fill=MUTED)
d.text((72, 244), "someone you choose — if you stop.", font=font(31), fill=MUTED)

facts = [
    ("Non-custodial", "keys and funds stay in World App"),
    # "audited" 라고 쓰면 안 된다. 이 앱에는 **독립 보안 감사가 없다** — 내부 감사
    # (서브에이전트 리뷰와 126개 forge 테스트)는 공개된 독립 감사와 같지 않다.
    # 스토어 이미지는 사용자가 가장 먼저 읽는 약속인데, 감사받지 않은 앱이 감사받은
    # 것처럼 적히면 그것 자체가 오류다. 말하는 것은 **검증 가능한 사실** 로 바꾼다.
    ("On-chain", "World Chain, allowlisted contracts"),
    ("Always revocable", "renew at any time to pull it back"),
]
y = 330
for k, v in facts:
    d.ellipse([72, y + 9, 84, y + 21], fill=ACCENT)
    d.text((100, y), k, font=font(24, True), fill=INK)
    d.text((100, y + 32), v, font=font(20), fill=MUTED)
    y += 82

thumb = Image.open(RAW / "store-2-countdown.png").convert("RGB")
scale = 560 / thumb.height
thumb = thumb.resize((max(1, int(thumb.width * scale)), 560), Image.LANCZOS)
thumb = rounded(thumb, 18)
shadow = Image.new("RGBA", (thumb.width + 40, thumb.height + 40), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    [20, 24, shadow.width - 20, shadow.height - 16], 18, fill=(15, 23, 42, 38)
)
meta.paste(shadow, (W - thumb.width - 120, 35), shadow)
meta.paste(thumb, (W - thumb.width - 100, 15), thumb)
d.text((72, H - 44), "inheritance.pages.dev", font=font(18), fill=MUTED)
meta.save(DST / "meta_tag.png", optimize=True)
print(f"meta_tag.png      {meta.size}")

# ------------------------------------------------------------------ logo
icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
di = ImageDraw.Draw(icon)
di.rounded_rectangle([0, 0, 511, 511], 112, fill=INK)
di.polygon([(256, 96), (416, 176), (416, 336), (256, 416), (96, 336), (96, 176)], outline=ACCENT, width=22)
di.ellipse([228, 228, 284, 284], fill=ACCENT)
icon.resize((512, 512), Image.LANCZOS).save(DST / "logo.png", optimize=True)
print("logo.png          (512, 512)")

print()
for p in sorted(DST.glob("*.png")):
    kb = p.stat().st_size / 1024
    warn = "  ← 500KB 초과, 업로드 거절된다" if kb > 500 else ""
    print(f"  {p.name:20} {kb:7.1f} KB{warn}")
