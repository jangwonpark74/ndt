"""Bounded OSRM driving-route requests for user-defined guide points."""
import json
import math
import os
import threading
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROUTING_URL = os.environ.get('NDT_ROUTING_URL', 'https://routing.openstreetmap.de/routed-car').rstrip('/')
_lock = threading.Lock()
_last_request = 0.0
_cache = {}


class RoutingUnavailable(Exception):
    pass


def validate_points(points, maximum=100):
    if not isinstance(points, list) or not 2 <= len(points) <= maximum:
        raise ValueError(f'Expected 2 to {maximum} route points')
    for point in points:
        if (not isinstance(point, list) or len(point) != 2 or
            any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point) or
            not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
            raise ValueError('Invalid route coordinate')
    if all(point == points[0] for point in points):
        raise ValueError('A route needs two distinct points')
    return points


def driving_route(points):
    global _last_request
    validate_points(points)
    key = json.dumps(points, separators=(',', ':'))
    if not _lock.acquire(blocking=False):
        raise RoutingUnavailable('Road routing is busy. Use Fit to roads to retry.')
    try:
        if key in _cache:
            return _cache[key]
        # The public service allows one request per second; no per-click or automatic retry traffic.
        time.sleep(max(0, 1 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        coordinates = ';'.join(','.join(str(value) for value in point) for point in points)
        query = urlencode(dict(overview='full', geometries='geojson', steps='false', alternatives='false',
                               radiuses=';'.join('150' for _ in points), generate_hints='false'))
        request = Request(f'{ROUTING_URL}/route/v1/driving/{coordinates}?{query}',
                          headers={'User-Agent': 'Regional-NDT-Viewer/0.1 (drive-test route planning)'})
        try:
            with urlopen(request, timeout=8) as response:
                raw = response.read(2000001)
            if len(raw) > 2000000:
                raise RoutingUnavailable('The road route is too detailed. Use fewer or closer waypoints.')
            result = json.loads(raw)
            if result.get('code') != 'Ok':
                raise RoutingUnavailable('No connected driving route was found within 150 m of the waypoints.')
            geometry = result['routes'][0]['geometry']
            if geometry['type'] != 'LineString':
                raise ValueError('Invalid road geometry')
            fitted = validate_points(geometry['coordinates'], 5000)
        except HTTPError as error:
            message = ('No connected driving route was found within 150 m of the waypoints.' if error.code == 400 else
                       'The road service is unavailable. Use Fit to roads to retry.')
            raise RoutingUnavailable(message) from error
        except (URLError, TimeoutError, OSError, HTTPException) as error:
            raise RoutingUnavailable('The road service is unavailable. Use Fit to roads to retry.') from error
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            raise RoutingUnavailable('The road service returned an invalid route. The original path is unchanged.') from error
        if len(_cache) >= 32:
            _cache.pop(next(iter(_cache)))
        _cache[key] = fitted
        return fitted
    finally:
        _lock.release()
