# Crea le icone dell'app (192, 512, maskable) e il logo per l'intestazione a partire dal logo del club.
# Uso: python3 scripts/make-icons.py percorso/logo.png [colore_sfondo_hex]
import sys
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGBA')
bg = sys.argv[2] if len(sys.argv) > 2 else '#ffffff'
def square(size, pad):
    canvas = Image.new('RGBA', (size, size), bg)
    inner = int(size * (1 - 2 * pad))
    im = src.copy(); im.thumbnail((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas.convert('RGB')
square(192, 0.08).save('web/icons/icon-192.png')
square(512, 0.08).save('web/icons/icon-512.png')
square(512, 0.20).save('web/icons/icon-maskable-512.png')   # area sicura per Android
logo = src.copy(); logo.thumbnail((240, 240), Image.LANCZOS); logo.save('web/icons/logo.png')
print('Icone create in web/icons/')
