"""Pinned, deliberately bounded downlink channel checks shared with the browser."""
import json
import math
from pathlib import Path

PLAN=json.loads((Path(__file__).resolve().parents[1]/'dist/carrier-bands.json').read_text(encoding='utf-8'))
BANDS={b['id']:b for b in PLAN['bands']}


def carrier_frequency(band,channel):
    b=BANDS[band]
    return round(b['frequencyBaseMHz']+(channel-b['channelOffset'])*b['rasterMHz'],6)


def validate_carrier(template,required=False):
    if 'carrier' not in template:
        if required:raise ValueError('Choose a supported band and channel before a qualified study.')
        return
    c=template['carrier']
    if not isinstance(c,dict) or set(c)!={'standard','band','channel','scsKHz'} or c['standard']!=PLAN['version']:
        raise ValueError('Unsupported carrier plan version or fields.')
    b=BANDS.get(c['band']) if isinstance(c['band'],str) else None
    if b is None:raise ValueError('Choose a supported band for this implementation.')
    if b['rat']!=template['rat']:raise ValueError('Selected band does not match the study RAT.')
    if type(c['scsKHz']) not in (int,float) or c['scsKHz']!=b['scsKHz']:raise ValueError(f"Supported SCS for {b['id']} in this implementation is {b['scsKHz']} kHz.")
    channel=c['channel']
    if type(channel) not in (int,float) or not -9007199254740991<=channel<=9007199254740991 or not math.isfinite(channel) or int(channel)!=channel:raise ValueError('Enter an integer EARFCN or NR-ARFCN.')
    if not b['channelLow']<=channel<=b['channelHigh'] or (channel-b['channelLow'])%b['channelStep']:
        raise ValueError(f"Follow the {b['id']} channel raster: {b['channelLow']} to {b['channelHigh']}, step {b['channelStep']}.")
    frequency=carrier_frequency(b['id'],channel)
    supplied=template['frequencyMHz']
    if type(supplied) not in (int,float) or abs(frequency-supplied)>1e-6 or not math.isfinite(supplied):
        raise ValueError(f'Carrier must match channel frequency {frequency:g} MHz.')
    bandwidth=template['bandwidthMHz']
    if type(bandwidth) not in (int,float) or bandwidth not in b['bandwidthsMHz']:
        raise ValueError(f"Supported {b['id']} bandwidth values (MHz): {', '.join(str(v) for v in b['bandwidthsMHz'])}.")
    if frequency-bandwidth/2<b['lowMHz']-1e-6 or frequency+bandwidth/2>b['highMHz']+1e-6:
        raise ValueError('Channel bandwidth crosses the operating band edge. Choose a channel farther inside the band.')
