from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MASTER_SIZE = 1024


def rounded_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=radius,
        fill=255,
    )
    return mask


def build_icon() -> Image.Image:
    size = MASTER_SIZE
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((54, 70, 970, 986), radius=224, fill=(0, 0, 0, 88))
    image.alpha_composite(shadow)

    panel = Image.new("RGBA", image.size, (0, 0, 0, 0))
    panel_draw = ImageDraw.Draw(panel)
    panel_draw.rounded_rectangle(
        (42, 42, 982, 982),
        radius=224,
        fill=(14, 24, 27, 255),
        outline=(77, 98, 102, 255),
        width=18,
    )
    image.alpha_composite(panel)

    grid = Image.new("RGBA", image.size, (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid)
    for position in range(128, 1024, 128):
        grid_draw.line((64, position, 960, position), fill=(86, 116, 120, 82), width=5)
        grid_draw.line((position, 64, position, 960), fill=(86, 116, 120, 82), width=5)
    grid.putalpha(Image.composite(grid.getchannel("A"), Image.new("L", image.size, 0), rounded_mask(size, 54, 210)))
    image.alpha_composite(grid)

    draw = ImageDraw.Draw(image)
    shadow_color = (0, 0, 0, 78)
    pin_color = (226, 122, 85, 255)
    pin_edge = (249, 166, 132, 255)

    draw.rounded_rectangle((304, 563, 732, 700), radius=49, fill=shadow_color)
    draw.polygon(((448, 372), (608, 372), (576, 552), (672, 611), (672, 666), (384, 666), (384, 611), (480, 552)), fill=shadow_color)
    draw.polygon(((496, 655), (560, 655), (528, 874)), fill=shadow_color)

    draw.rounded_rectangle((286, 197, 738, 405), radius=78, fill=pin_color, outline=pin_edge, width=14)
    draw.polygon(((414, 374), (610, 374), (574, 536), (674, 596), (674, 650), (350, 650), (350, 596), (450, 536)), fill=pin_color)
    draw.rounded_rectangle((336, 578, 688, 682), radius=42, fill=pin_color, outline=pin_edge, width=10)
    draw.polygon(((477, 669), (547, 669), (512, 895)), fill=pin_color)
    draw.line((512, 680, 512, 844), fill=(255, 190, 159, 210), width=12)
    draw.rounded_rectangle((356, 238, 668, 272), radius=17, fill=(255, 203, 177, 140))

    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    master = build_icon()
    master.resize((512, 512), Image.Resampling.LANCZOS).save(ASSETS / "app-icon.png")
    master.save(
        ASSETS / "app-icon.ico",
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
