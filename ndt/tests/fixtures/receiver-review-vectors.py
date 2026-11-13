"""Frozen source-grid/array receiver pairs for independent browser replay."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.simulation import simulate
from backend.dm.polarization import RECEIVER_MODEL
spec=importlib.util.spec_from_file_location('scalar_vectors',Path(__file__).with_name('rf-review-vectors.py'))
scalar=importlib.util.module_from_spec(spec);spec.loader.exec_module(scalar)
base=next(t for t in scalar.vectors() if t['context']['model']=='uma-source-patterns-fixed-heights-v5' and not 'low-null' in t['id'])
result=[]
for kind in ['dual','single','null']:
    receiver=dict(model=RECEIVER_MODEL,collection='dual-orthogonal' if kind=='dual' else 'single-linear',
                  orientation=dict(azimuthDeg=0,tiltDeg=0,rollDeg=0,slantDeg=90))
    for variant in ['A','B']:
        test=deepcopy(base);context=test['context']
        context.update(schema='ndt.execution.v6',model='uma-los-receiver-fixed-heights-v6',predictionModel='uma-los-receiver-fixed-heights-v6',
                       id='SNAP-receiver-'+kind,experiment_id='EXP-receiver-'+kind,variant=variant,comparisonKind='scenario-revisions',
                       receiverAssumptions=dict(model=RECEIVER_MODEL,applied=receiver,baseline=None))
        for port in context['transmitters'][0]['ports']:
            t=port['template'];t.update(mode='LOS',tiltDeg=0)
            if t['pattern']=='sampled':t['sampled']['rollDeg']=0
            if variant=='B':t['polarization']=dict(model='3gpp-38.901-model2',slantDeg=90 if kind=='single' and port['linkId']=='link-2' else 0,**({} if t['pattern']=='sampled' else dict(rollDeg=0)))
        if variant=='B':context['radioScenario']['payload']['receiver']=receiver
        test['id']='receiver-'+kind+'-'+variant
        test['rows']=simulate(context,context['case'],context['powers'],interval_s=context['interval_s'],rat=context['rat'],mode='LOS',time_origin=context['time_origin'],cancelled=lambda:False)
        result.append(test)
print(json.dumps(result))
