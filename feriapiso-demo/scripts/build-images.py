#!/usr/bin/env python3
"""Build fallback cover images for the public demo."""
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image, ImageDraw

for name, label, color in [
    ("p1/01.jpg", "Palmer I", (0, 139, 124)),
    ("p2/01.jpg", "Palmer II", (0, 110, 100)),
    ("p3/01.jpg", "Palmer III", (20, 90, 120)),
]:
    path = Path("feriapiso-demo/fotos") / name
    if path.exists() and path.stat().st_size > 1000:
        continue
    path.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", (800, 520), color)
    d = ImageDraw.Draw(im)
    d.text((40, 220), label, fill=(255, 255, 255))
    d.text((40, 280), "feriapiso demo", fill=(220, 240, 235))
    im.save(path, "JPEG", quality=85)
    print("placeholder", path)
