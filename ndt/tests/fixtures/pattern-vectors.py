"""Numerical parity fixture, supplied grid and directions are independent test data."""
import json,math,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.pattern_models import ScalarGainGrid,local_direction
request=json.load(sys.stdin);g=ScalarGainGrid(request['grid']);rows=[]
for f,a,e,t,r in request['vectors']:
 la,le=local_direction(a,e,t,r);ar,er=math.radians(la),math.radians(le)
 rows.append([g.gain(f,la,le),g.peak_gain_dbi(f),g.attenuation(f,la,le),math.cos(er)*math.cos(ar),math.cos(er)*math.sin(ar),math.sin(er)])
json.dump(rows,sys.stdout,allow_nan=False)
