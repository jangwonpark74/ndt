"""TR 38.901 7.3.2 Model-2 fields and reciprocal LOS receiver collection.

World vectors use right-handed East/North/Up. Bearings are clockwise from North;
positive downtilt points down and positive mechanical roll is clockwise looking
out along boresight. This is a reference LOS transfer, not NLOS depolarization.
"""
import math

RECEIVER_MODEL = 'ndt.receiver.los-model2.v1'
POLARIZATION_MODEL = '3gpp-38.901-model2'
ORIENTATION_BOUNDS = dict(azimuthDeg=(0, 359.999), tiltDeg=(-90, 90),
                          rollDeg=(-180, 180), slantDeg=(-90, 90))
NULL_POWER_FRACTION = 1e-28


def _number(value, low, high, label):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label}: enter a finite number from {low} to {high}')
    return value


def _dot(a, b):
    return math.fsum(x*y for x, y in zip(a, b))


def _cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def _unit(a):
    length = math.hypot(*a)
    return [x/length for x in a]


def _direction(azimuth, elevation):
    a = math.radians(_number(azimuth, 0, 360, 'Link bearing'))
    e = math.radians(_number(elevation, -90, 90, 'Link elevation'))
    return [math.cos(e)*math.sin(a), math.cos(e)*math.cos(a), math.sin(e)]


class _Polarization:
    def __init__(self, orientation):
        a, t, r, slant = [math.radians(orientation[k]) for k in ORIENTATION_BOUNDS]
        right = [math.cos(a), -math.sin(a), 0]
        up = [math.sin(a)*math.sin(t), math.cos(a)*math.sin(t), math.cos(t)]
        self.up = [right[i]*math.sin(r)+up[i]*math.cos(r) for i in range(3)]
        self.left = [-right[i]*math.cos(r)+up[i]*math.sin(r) for i in range(3)]
        self.cos_slant, self.sin_slant = math.cos(slant), math.sin(slant)

    def vector(self, direction, orthogonal=False):
        phi = _cross(self.up, direction)
        if math.hypot(*phi) < 1e-12:
            # Spherical chart pole: phi=0, with the body's left axis projected transverse.
            along = _dot(self.left, direction)
            phi = [self.left[i]-along*direction[i] for i in range(3)]
        phi = _unit(phi)
        theta = _cross(phi, direction)
        c, s = (-self.sin_slant, self.cos_slant) if orthogonal else (self.cos_slant, self.sin_slant)
        return [c*theta[i]+s*phi[i] for i in range(3)]

    def field(self, azimuth, elevation):
        return self.vector(_direction(azimuth, elevation))


def prepare_polarization(orientation):
    if not isinstance(orientation, dict) or set(orientation) != set(ORIENTATION_BOUNDS):
        raise ValueError('Provide antenna bearing, downtilt, mechanical roll and Model-2 slant')
    for key, (low, high) in ORIENTATION_BOUNDS.items():
        _number(orientation[key], low, high, key)
    return _Polarization(orientation)


class _Receiver:
    def __init__(self, value):
        self.field = prepare_polarization(value['orientation'])
        self.dual = value['collection'] == 'dual-orthogonal'

    def coupling(self, transmitter, azimuth, elevation):
        if not isinstance(transmitter, _Polarization):
            raise ValueError('Prepare the transmitter polarization before receiver evaluation')
        direction = _direction(azimuth, elevation)
        tx = transmitter.vector(direction)
        incoming = [-x for x in direction]
        rx = [self.field.vector(incoming)]
        if self.dual:
            rx.append(self.field.vector(incoming, orthogonal=True))
        fraction = math.fsum(_dot(tx, field)**2 for field in rx)
        if not math.isfinite(fraction) or fraction > 1+1e-12:
            raise ValueError('Receiver projection violates passive power collection')
        fraction = 0 if fraction < NULL_POWER_FRACTION else 1 if fraction > 1-1e-12 else fraction
        return dict(powerFraction=fraction, mismatchLossDb=-10*math.log10(fraction) if fraction else None,
                    txField=tx, rxFields=rx)


def prepare_receiver(value):
    if not isinstance(value, dict) or set(value) != {'model', 'collection', 'orientation'}:
        raise ValueError('Provide a complete versioned LOS reference receiver')
    if value['model'] != RECEIVER_MODEL or value['collection'] not in ('single-linear', 'dual-orthogonal'):
        raise ValueError('Select single-linear or ideal dual-orthogonal LOS Model-2 collection')
    return _Receiver(value)


def template_orientation(template):
    value = template.get('polarization')
    grid = template.get('pattern') == 'sampled'
    keys = {'model', 'slantDeg'} if grid else {'model', 'slantDeg', 'rollDeg'}
    if not isinstance(value, dict) or set(value) != keys or value.get('model') != POLARIZATION_MODEL:
        raise ValueError('Provide explicit Model-2 transmitter polarization; grids use their existing mechanical roll')
    if template.get('mode') != 'LOS':
        raise ValueError('The reference receiver requires LOS; NLOS depolarization is not implemented')
    return dict(azimuthDeg=template['azimuthDeg'], tiltDeg=template['tiltDeg'],
                rollDeg=template.get('sampled',{}).get('rollDeg') if grid else value['rollDeg'], slantDeg=value['slantDeg'])


def validate_template_polarization(template):
    if 'polarization' in template:
        prepare_polarization(template_orientation(template))


def validate_receiver_templates(receiver, templates):
    if receiver is None:
        if any('polarization' in t for t in templates):
            raise ValueError('Explicit transmitter polarization requires its LOS receiver study')
        return None
    prepared = prepare_receiver(receiver)
    for template in templates:
        prepare_polarization(template_orientation(template))
    return prepared
