"""Build SVG and Cesium-compatible PNG from public-domain Natural Earth land.

Run with: uv run --with pillow python scripts/generate_earth_outline.py
"""
import json
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageDraw

SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
TARGET = Path(__file__).resolve().parents[1] / "app/static/earth_outline.svg"


def main():
    with urlopen(SOURCE, timeout=30) as response:
        data = json.load(response)
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024" viewBox="0 0 2048 1024">',
        '<title>World land outlines</title>',
        '<desc>Natural Earth 1:110m land, public domain. Plate carree projection; '
        'longitude -180 to 180, latitude 90 to -90. '
        'https://www.naturalearthdata.com/about/terms-of-use/</desc>',
        '<rect width="2048" height="1024" fill="#07111f"/>',
        '<g fill="#12283b" stroke="#6994b2" stroke-width="1.3" stroke-linejoin="round" fill-rule="evenodd">',
    ]
    # Rasterize from the same geographic coordinates. Cesium's ImageBitmap
    # loader cannot decode SVG in all browsers. Supersample the coastlines.
    scale = 2
    image = Image.new("RGB", (2048 * scale, 1024 * scale), "#07111f")
    draw = ImageDraw.Draw(image)
    for feature in data["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            rings = []
            for index, ring in enumerate(polygon):
                coords = [f"{(lon + 180) * 2048 / 360:.2f},{(90 - lat) * 1024 / 180:.2f}" for lon, lat in ring]
                rings.append("M" + "L".join(coords) + "Z")
                points = [((lon + 180) * 2048 * scale / 360, (90 - lat) * 1024 * scale / 180) for lon, lat in ring]
                draw.polygon(points, fill="#12283b" if index == 0 else "#07111f")
                draw.line(points, fill="#6994b2", width=3, joint="curve")
            parts.append('<path d="' + "".join(rings) + '"/>')
    parts.extend(['</g>', '</svg>'])
    TARGET.write_text("\n".join(parts) + "\n", encoding="utf-8")
    image.resize((2048, 1024), Image.Resampling.LANCZOS).save(TARGET.with_suffix(".png"), optimize=True)
    print(f"Generated {TARGET.name}: {TARGET.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
