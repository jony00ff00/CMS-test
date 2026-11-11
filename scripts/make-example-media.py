"""Draws the pictures and short videos for the "Two outputs" example (examples/two-outputs/).

Three scenes of a community garden, each as a still picture (PNG) and as a 3-second looping video (WebM, VP9) whose
first frame is the picture. Needs Pillow and ffmpeg: python3 scripts/make-example-media.py
"""
import math, os, random, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw

W, H, FPS, SECONDS = 640, 360, 24, 3
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'examples', 'two-outputs')


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(d, top, bottom, horizon):
    for y in range(horizon):
        d.line([(0, y), (W, y)], fill=lerp(top, bottom, y / horizon))


def beds(d, horizon, sway=0.0):
    d.rectangle([0, horizon, W, H], fill=(92, 64, 40))
    for row in range(4):
        y = horizon + 18 + row * 38
        d.rectangle([20, y + 18, W - 20, y + 30], fill=(70, 48, 30))
        for i in range(22):
            x = 34 + i * 27 + (row % 2) * 12
            lean = math.sin(sway + i * 0.7 + row) * 4
            d.line([(x, y + 22), (x + lean, y)], fill=(46, 125, 50), width=3)
            d.ellipse([x + lean - 6, y - 8, x + lean + 6, y + 4], fill=(76, 175, 80))


def dawn(t):
    """The garden at dawn: the sun rises, the sky warms."""
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    horizon = 200
    sky(d, lerp((38, 50, 92), (120, 170, 220), t), lerp((240, 150, 90), (250, 214, 160), t), horizon)
    sun_y = horizon - 10 - t * 70
    d.ellipse([440, sun_y - 30, 500, sun_y + 30], fill=(255, 214, 102))
    d.polygon([(0, horizon), (120, 150), (260, horizon)], fill=(60, 90, 80))
    d.polygon([(180, horizon), (340, 135), (520, horizon)], fill=(70, 105, 90))
    beds(d, horizon, sway=t * 2 * math.pi)
    return img


def hives(t):
    """Bee hives by the hedge: bees circle the hives."""
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    horizon = 230
    sky(d, (135, 190, 235), (205, 230, 245), horizon)
    d.rectangle([0, horizon - 40, W, horizon], fill=(56, 120, 60))
    d.rectangle([0, horizon, W, H], fill=(110, 170, 80))
    for k, x in enumerate((140, 300, 460)):
        d.rectangle([x - 45, 210, x + 45, 300], fill=(240, 200, 110), outline=(150, 110, 50), width=3)
        for j in range(1, 4):
            d.line([(x - 45, 210 + j * 22), (x + 45, 210 + j * 22)], fill=(170, 130, 60), width=2)
        d.polygon([(x - 55, 210), (x, 180), (x + 55, 210)], fill=(170, 80, 50))
        d.rectangle([x - 12, 290, x + 12, 300], fill=(60, 40, 20))
        for b in range(6):
            a = t * 2 * math.pi + b * math.pi / 3 + k
            bx, by = x + math.cos(a) * (60 + b * 6), 200 + math.sin(a * 2) * 30 - b * 6
            d.ellipse([bx - 5, by - 3, bx + 5, by + 3], fill=(40, 30, 10))
            d.ellipse([bx - 3, by - 3, bx + 1, by + 3], fill=(250, 200, 30))
    return img


def rain(t):
    """Rain over the ponds: drops fall, rings spread."""
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    horizon = 150
    sky(d, (110, 120, 135), (165, 175, 185), horizon)
    d.rectangle([0, horizon, W, H], fill=(85, 120, 70))
    for cx, cy, rx, ry in ((180, 250, 140, 55), (470, 280, 120, 45)):
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(70, 110, 140))
    rnd = random.Random(7)
    drops = [(rnd.uniform(0, W), rnd.uniform(0, 1)) for _ in range(90)]
    for x, phase in drops:
        y = ((phase + t) % 1) * H
        d.line([(x, y), (x - 3, y + 12)], fill=(200, 215, 230), width=1)
    rings = [(180 + rnd.uniform(-100, 100), 250 + rnd.uniform(-30, 30), rnd.uniform(0, 1)) for _ in range(10)]
    rings += [(470 + rnd.uniform(-80, 80), 280 + rnd.uniform(-25, 25), rnd.uniform(0, 1)) for _ in range(8)]
    for x, y, phase in rings:
        r = ((phase + t) % 1) * 22
        d.ellipse([x - r, y - r * 0.4, x + r, y + r * 0.4], outline=(170, 200, 220), width=1)
    return img


SCENES = {'garden-dawn': dawn, 'bee-hives': hives, 'rain-ponds': rain}


def main():
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is needed for the videos')
    os.makedirs(OUT, exist_ok=True)
    for name, draw in SCENES.items():
        draw(0).save(os.path.join(OUT, f'{name}.png'), optimize=True)
        with tempfile.TemporaryDirectory() as tmp:
            frames = FPS * SECONDS
            for i in range(frames):
                # t goes 0 → 1 → 0 for dawn (it plays back and forth); the loops (bees, rain) just repeat.
                t = i / frames
                draw(math.sin(t * math.pi) if draw is dawn else t).save(os.path.join(tmp, f'{i:04d}.png'))
            subprocess.run(
                ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(tmp, '%04d.png'),
                 '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-an',
                 os.path.join(OUT, f'{name}.webm')],
                check=True,
            )
        print('wrote', name)


if __name__ == '__main__':
    main()
