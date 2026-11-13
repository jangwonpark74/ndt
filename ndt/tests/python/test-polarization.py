"""Independent geometric and closed-form checks for the LOS receiver model."""
import math
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.dm.polarization import prepare_polarization, prepare_receiver, RECEIVER_MODEL


def orientation(**changes):
    return dict(azimuthDeg=0, tiltDeg=0, rollDeg=0, slantDeg=0) | changes


def receiver(collection='single-linear', **changes):
    return prepare_receiver(dict(model=RECEIVER_MODEL, collection=collection,
                                 orientation=orientation(**changes)))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def matrix_oracle(o, azimuth, elevation):
    # Independent Euler-matrix/local-spherical implementation of clauses 7.1 and 7.3.2.
    a, t, r, slant = map(math.radians, (90-o['azimuthDeg'], o['tiltDeg'], o['rollDeg'], o['slantDeg']))
    rz = [[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]]
    ry = [[math.cos(t), 0, math.sin(t)], [0, 1, 0], [-math.sin(t), 0, math.cos(t)]]
    rx = [[1, 0, 0], [0, math.cos(r), -math.sin(r)], [0, math.sin(r), math.cos(r)]]
    multiply = lambda a, b: [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    rotation = multiply(multiply(rz, ry), rx)
    az, el = map(math.radians, (azimuth, elevation))
    direction = [math.cos(el)*math.sin(az), math.cos(el)*math.cos(az), math.sin(el)]
    local = [sum(rotation[i][j]*direction[i] for i in range(3)) for j in range(3)]
    theta = math.acos(max(-1, min(1, local[2])))
    phi = math.atan2(local[1], local[0]) if math.hypot(local[0], local[1]) >= 1e-12 else 0
    theta_field = [math.cos(theta)*math.cos(phi), math.cos(theta)*math.sin(phi), -math.sin(theta)]
    phi_field = [-math.sin(phi), math.cos(phi), 0]
    field = [math.cos(slant)*theta_field[i]+math.sin(slant)*phi_field[i] for i in range(3)]
    return [sum(rotation[i][j]*field[j] for j in range(3)) for i in range(3)]


class PolarizationTests(unittest.TestCase):
    def assertVector(self, actual, expected):
        for a, b in zip(actual, expected):
            self.assertAlmostEqual(a, b, places=12)

    def test_reference_basis_and_mechanical_rotation(self):
        self.assertVector(prepare_polarization(orientation()).field(0, 0), [0, 0, -1])
        self.assertVector(prepare_polarization(orientation(slantDeg=90)).field(0, 0), [-1, 0, 0])
        self.assertVector(prepare_polarization(orientation(rollDeg=90)).field(0, 0), [-1, 0, 0])
        self.assertVector(prepare_polarization(orientation(azimuthDeg=90, slantDeg=90)).field(90, 0), [0, 1, 0])
        self.assertVector(prepare_polarization(orientation(tiltDeg=30)).field(0, -30), [0, -.5, -math.sqrt(.75)])
        self.assertVector(prepare_polarization(orientation()).field(0, 90), [0, 1, 0])
        self.assertVector(prepare_polarization(orientation()).field(0, -90), [0, -1, 0])

    def test_los_reciprocity_and_polarization_null_are_not_double_gain(self):
        # Opposing look directions reverse phi; matching local slants have opposite signs.
        for tx_slant, rx_slant in [(0, 0), (30, 20), (45, -45), (90, 90), (89.999, 0)]:
            tx = prepare_polarization(orientation(slantDeg=tx_slant))
            result = receiver(slantDeg=rx_slant).coupling(tx, 0, 0)
            expected = math.cos(math.radians(tx_slant+rx_slant))**2
            self.assertAlmostEqual(result['powerFraction'], expected, places=12)
            reciprocal = receiver(slantDeg=tx_slant).coupling(
                prepare_polarization(orientation(slantDeg=rx_slant)), 180, 0)
            self.assertAlmostEqual(result['powerFraction'], reciprocal['powerFraction'], places=12)
        null = receiver(slantDeg=90).coupling(prepare_polarization(orientation()), 0, 0)
        self.assertEqual(null['powerFraction'], 0)
        self.assertIsNone(null['mismatchLossDb'])

    def test_arbitrary_orientations_preserve_transversality_and_dual_power(self):
        rng = random.Random(38901)
        for _ in range(150):
            values = dict(azimuthDeg=rng.uniform(0, 359), tiltDeg=rng.uniform(-90, 90),
                          rollDeg=rng.uniform(-180, 180), slantDeg=rng.uniform(-90, 90))
            az, el = rng.uniform(0, 359), rng.uniform(-90, 90)
            tx = prepare_polarization(values)
            f = tx.field(az, el)
            self.assertVector(f, matrix_oracle(values, az, el))
            a, e = map(math.radians, (az, el))
            direction = [math.cos(e)*math.sin(a), math.cos(e)*math.cos(a), math.sin(e)]
            self.assertAlmostEqual(dot(f, f), 1, places=12)
            self.assertAlmostEqual(dot(f, direction), 0, places=12)
            single = receiver(**values).coupling(tx, az, el)
            dual = receiver('dual-orthogonal', **values).coupling(tx, az, el)
            self.assertGreaterEqual(single['powerFraction'], 0)
            self.assertLessEqual(single['powerFraction'], 1)
            self.assertEqual(dual['powerFraction'], 1)

    def test_mutating_input_cannot_change_prepared_orientation(self):
        source = orientation()
        prepared = prepare_polarization(source)
        source['rollDeg'] = 90
        self.assertVector(prepared.field(0, 0), [0, 0, -1])

    def test_rejects_ambiguous_or_nonfinite_contracts(self):
        for values in [None, {}, {**orientation(), 'phaseDeg': 0}, {**orientation(), 'slantDeg': None},
                       {**orientation(), 'tiltDeg': True}, {**orientation(), 'rollDeg': float('nan')}]:
            with self.assertRaises(ValueError):
                prepare_polarization(values)
        for changes in [dict(model='future'), dict(collection='coherent-mimo'), dict(phaseDeg=0)]:
            with self.assertRaises(ValueError):
                prepare_receiver(dict(model=RECEIVER_MODEL, collection='single-linear',
                                      orientation=orientation()) | changes)


if __name__ == '__main__':
    unittest.main()
