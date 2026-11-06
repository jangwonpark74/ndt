"""Small, deterministic helpers for extracting OSM tree points and rows."""
import math
import re

ZOOM = 14


def metres(value):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|\')?\s*', str(value or ''), re.I)
    if not match:
        return 0.0
    result = float(match.group(1))
    return result * 0.3048 if (match.group(2) or '').lower() in ('ft', 'feet', "'") else result


def tile(lon, lat, zoom=ZOOM):
    n = 1 << zoom
    lat = max(-85.05112878, min(85.05112878, lat))
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(n - 1, max(0, x)), min(n - 1, max(0, y))


def sample_row(points, count=None, spacing=8):
    """Sample a mapped tree_row; positions are estimates unless nodes were mapped."""
    if len(points) < 2:
        return []
    lengths = []
    for a, b in zip(points, points[1:]):
        dx = (b[0] - a[0]) * 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
        dy = (b[1] - a[1]) * 111320
        lengths.append(math.hypot(dx, dy))
    total = sum(lengths)
    if total <= 0:
        return []
    amount = max(1, min(1000, count if count is not None and count > 0 else round(total / max(1, spacing)) + 1))
    result = []
    index, start = 0, 0.0
    for i in range(amount):
        distance = total / 2 if amount == 1 else total * i / (amount - 1)
        while index < len(lengths) - 1 and start + lengths[index] < distance:
            start += lengths[index]
            index += 1
        length = lengths[index]
        t = (distance - start) / length if length else 0
        a, b = points[index], points[index + 1]
        result.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return result
