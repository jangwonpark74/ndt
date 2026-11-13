"""Shared numeric radio-template validation for saved studies and cell assignments."""
import math
from .carrier_plan import validate_carrier
from .equipment_studies import validate_equipment_reference
from .dm.antenna import validate_array
from .pattern_studies import validate_sampled


def validate_radio_template(template):
    bounds = dict(frequencyMHz=(500, 100000), bandwidthMHz=(.1, 400), powerDbm=(-30, 80),
                  gainDbi=(-120,50) if isinstance(template,dict) and template.get('pattern')=='sampled' else (0,40), lossDb=(0, 40), tiltDeg=(-20, 90), azimuthDeg=(0, 359.999))
    if not isinstance(template, dict) or set(template)-{'carrier','equipmentSource','array','sampled'} != set(bounds) | {'rat', 'pattern', 'mode'}:
        raise ValueError('A complete radio template is required')
    for field, (low, high) in bounds.items():
        value = template[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high or not math.isfinite(value):
            raise ValueError(f'Invalid {field}: expected {low} to {high}')
    if template['rat'] not in ('LTE', 'NR') or template['pattern'] not in ('element', 'isotropic','array','sampled') or template['mode'] not in ('LOS', 'NLOS'):
        raise ValueError('Unsupported RAT, antenna pattern or environment')
    if template['bandwidthMHz'] >= template['frequencyMHz']:
        raise ValueError('Bandwidth must be smaller than carrier frequency')
    if template['pattern'] == 'isotropic' and template['gainDbi'] != 0:
        raise ValueError('An isotropic antenna requires 0 dBi gain')
    validate_array(template)
    validate_sampled(template)
    validate_carrier(template)
    if 'equipmentSource' in template:validate_equipment_reference(template['equipmentSource'])
    return template
