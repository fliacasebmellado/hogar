"""Genera los íconos PNG de la PWA (casa simple sobre fondo neutro). Uso: python scripts/make-icons.py"""
from PIL import Image, ImageDraw

BG = (41, 37, 36)      # gris cálido oscuro
FG = (250, 250, 249)   # blanco cálido
ACCENT = (214, 211, 209)

def icon(size, maskable=False, path=""):
    img = Image.new("RGBA", (size, size), BG + (255,))
    d = ImageDraw.Draw(img)
    pad = size * (0.26 if maskable else 0.18)
    w = size - 2 * pad
    roof_top = pad + w * 0.05
    roof_base = pad + w * 0.45
    d.polygon([(pad, roof_base), (size / 2, roof_top), (size - pad, roof_base)], fill=FG)
    body_l, body_r = pad + w * 0.14, size - pad - w * 0.14
    d.rectangle([body_l, roof_base - 1, body_r, pad + w * 0.95], fill=FG)
    door_w = w * 0.18
    d.rectangle([size / 2 - door_w / 2, pad + w * 0.62, size / 2 + door_w / 2, pad + w * 0.95], fill=BG)
    d.ellipse([size / 2 - w * 0.06, pad + w * 0.36, size / 2 + w * 0.06, pad + w * 0.48], fill=ACCENT)
    img.save(path)

icon(192, path="public/icons/icon-192.png")
icon(512, path="public/icons/icon-512.png")
icon(512, maskable=True, path="public/icons/icon-maskable-512.png")
icon(180, path="public/icons/apple-touch-icon.png")
icon(64, path="public/favicon.png")
print("ok")
