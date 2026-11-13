"""Deterministic cross-language reference fields and reciprocal receiver powers."""
from pathlib import Path
import json
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.dm.polarization import prepare_polarization, prepare_receiver, RECEIVER_MODEL

rng = random.Random(3890102)
rows = []
for i in range(180):
    orientations = [dict(azimuthDeg=rng.uniform(0, 359), tiltDeg=rng.uniform(-90, 90),
                         rollDeg=rng.uniform(-180, 180), slantDeg=rng.uniform(-90, 90)) for _ in range(2)]
    azimuth, elevation = rng.uniform(0, 359), rng.uniform(-90, 90)
    receiver = dict(model=RECEIVER_MODEL, collection='single-linear' if i % 2 else 'dual-orthogonal',
                    orientation=orientations[1])
    tx = prepare_polarization(orientations[0])
    rows.append(dict(transmitter=orientations[0], receiver=receiver, azimuth=azimuth, elevation=elevation,
                     expected=prepare_receiver(receiver).coupling(tx, azimuth, elevation)))
print(json.dumps(rows))
