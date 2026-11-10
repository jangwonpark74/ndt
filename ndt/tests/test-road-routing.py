import io
import json
from http.client import IncompleteRead
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import road_routing
import server

POINTS = [[-79.413, 43.761], [-79.412, 43.77]]
FITTED = [POINTS[0], [-79.4125, 43.765], POINTS[1]]


class RoutingTests(unittest.TestCase):
    def setUp(self):
        road_routing._cache.clear()
        self.sleep = patch.object(road_routing.time, 'sleep').start()
        self.addCleanup(patch.stopall)

    def response(self, geometry=FITTED):
        context = Mock()
        context.__enter__ = Mock(return_value=io.BytesIO(json.dumps({'code':'Ok', 'routes':[{'geometry':{'type':'LineString', 'coordinates':geometry}}]}).encode()))
        context.__exit__ = Mock(return_value=False)
        return context

    def test_driving_geometry_is_bounded_attributed_rate_limited_and_cached(self):
        with patch.object(road_routing, 'urlopen', return_value=self.response()) as fetch:
            self.assertEqual(road_routing.driving_route(POINTS), FITTED)
            self.assertEqual(road_routing.driving_route(POINTS), FITTED)
            fetch.assert_called_once()
            request = fetch.call_args.args[0]
            self.assertIn('/route/v1/driving/', request.full_url)
            self.assertIn('radiuses=150%3B150', request.full_url)
            self.assertIn('overview=full', request.full_url)
            self.assertIn('Regional-NDT-Viewer', request.get_header('User-agent'))
            self.assertEqual(fetch.call_args.kwargs['timeout'], 8)
            self.sleep.assert_called_once()

    def test_rejects_bad_inputs_before_using_the_network(self):
        with patch.object(road_routing, 'urlopen') as fetch:
            for points in ([], [[0,0],[0,0]], [[True,0],[1,2]], [[181,0],[1,2]], POINTS*51):
                with self.assertRaises(ValueError): road_routing.driving_route(points)
            fetch.assert_not_called()

    def test_service_failures_and_invalid_geometry_do_not_return_a_fitted_route(self):
        for error in (URLError('offline'), TimeoutError(), IncompleteRead(b''), HTTPError('url',400,'NoSegment',{},None)):
            with patch.object(road_routing, 'urlopen', side_effect=error):
                with self.assertRaises(road_routing.RoutingUnavailable): road_routing.driving_route(POINTS)
        with patch.object(road_routing, 'urlopen', return_value=self.response([[999,0],[0,0]])):
            with self.assertRaises(road_routing.RoutingUnavailable): road_routing.driving_route(POINTS)
        road_routing._lock.acquire()
        try:
            with self.assertRaisesRegex(road_routing.RoutingUnavailable, 'busy'): road_routing.driving_route(POINTS)
        finally: road_routing._lock.release()

    def test_post_endpoint_keeps_request_coordinates_out_of_the_url_and_reports_failure(self):
        handler_type = server.handler_for(Path('/unused.sqlite3'))
        handler = handler_type.__new__(handler_type)
        handler.respond, handler.send_error = Mock(), Mock()
        def post(points):
            payload = json.dumps(points).encode()
            handler.path = '/api/road-route'
            handler.headers = {'Content-Length':str(len(payload))}
            handler.rfile = io.BytesIO(payload)
            handler.do_POST()
        with patch.object(server, 'driving_route', return_value=FITTED) as route:
            post(POINTS)
            route.assert_called_once_with(POINTS)
            self.assertEqual(json.loads(handler.respond.call_args.args[0])['coordinates'], FITTED)
        with patch.object(server, 'driving_route', side_effect=road_routing.RoutingUnavailable('Offline')):
            post(POINTS)
            self.assertEqual(handler.respond.call_args.args[2],503)
        post([[True,0],[1,2]])
        handler.send_error.assert_called_once_with(400,'Invalid route guide points')


if __name__ == '__main__': unittest.main()
