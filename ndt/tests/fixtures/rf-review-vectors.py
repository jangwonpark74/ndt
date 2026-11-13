"""Canonical Python frozen-run oracles for the independent browser review."""
from copy import deepcopy
from pathlib import Path
import hashlib,json,math,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.simulation import simulate
from backend.dm.antenna import peak_eirp
from backend.cell_assignments import cell_eirp
from backend.pattern_studies import pattern_summaries
from backend.dm.model_versions import LEGACY_UMA,DIRECTIONAL_UMA,ARRAY_UMA,CELL_UMA,PATTERN_UMA

ROOT=Path(__file__).parent
BASE=dict(rat='NR',frequencyMHz=3600,bandwidthMHz=100,powerDbm=30,gainDbi=8,lossDb=2,azimuthDeg=0,tiltDeg=6,pattern='element',mode='NLOS')
ARRAY=dict(rows=64,columns=64,verticalSpacing=.5,horizontalSpacing=.5,steerAzimuthDeg=0,steerDowntiltDeg=0)

def vectors():
    result=[]
    for model,low_null in [(m,False) for m in [LEGACY_UMA,DIRECTIONAL_UMA,ARRAY_UMA,CELL_UMA,PATTERN_UMA]]+[(PATTERN_UMA,True)]:
        source=model in (CELL_UMA,PATTERN_UMA)
        data=json.loads((ROOT/'equipment-example.json').read_text(encoding='utf8'))
        data['schemaVersion']=2;data['cells'][0]['frequencyMHz']=3600;data['patterns'][0]['radiation']=json.loads((ROOT/'scalar-pattern-grid.json').read_text(encoding='utf8'))
        for old,identity,name in [('radio-port-1','rp2','TX2'),('antenna-port-1','ap2','P2')]:data['ports'].append(dict(next(p for p in data['ports'] if p['id']==old),id=identity,name=name))
        data['links'].append(dict(data['links'][0],id='link-2',radioPortId='rp2',antennaPortId='ap2'))
        if low_null:
            grid=data['patterns'][0]['radiation'];grid['azimuthDeg']=[-180,-.001,0,.001,180];grid['elevationDeg']=[-90,-.001,0,.001,90]
            grid['gainDbi']=[[[50 if e==2 and a==2 else -120 for a in range(5)] for e in range(5)] for _ in range(2)]
        raw='\ufeff'+json.dumps(data,ensure_ascii=False);sha=hashlib.sha256(raw.encode()).hexdigest()
        a=deepcopy(BASE)
        if model==ARRAY_UMA:a.update(pattern='array',array=deepcopy(ARRAY),tiltDeg=0,powerDbm=5)
        tx=dict(id='site-a',site_id='TEST-SITE',label='Frozen site A',coordinates=[-79.4,43.7],frequency_mhz=3600,template=a)
        suffix='-low-null' if low_null else ''
        snap=dict(id='SNAP-review-'+model+suffix,schema='ndt.execution.v1',predictionModel=model,route=dict(id='r',name='Frozen route',coordinates=[[-79.4,43.70001],[-79.4,43.701],[-79.4,43.76]]),
                  scope=dict(region_id='toronto',project_id='p',task_id='task'),time_origin=1700000000000,transmitters=[tx])
        if model!=LEGACY_UMA:snap['radioScenario']=dict(id='study',revision=1,payload=dict(radioBudgets={'radio-1':40}))
        if source:
            ports=[]
            for link,radio_port,antenna_port in [('link-1','radio-port-1','antenna-port-1'),('link-2','rp2','ap2')]:
                if low_null and link=='link-2':continue
                t=deepcopy(BASE);t['equipmentSource']=dict(revision=1,sha256=sha,cellId='cell-1',linkId=link)
                if link=='link-2':t.update(pattern='array',array=deepcopy(ARRAY),tiltDeg=0,powerDbm=5)
                if model==PATTERN_UMA and link=='link-1':t.update(pattern='sampled',gainDbi=10*math.log10(1.5),tiltDeg=0,sampled=dict(format='ndt.scalar-gain-grid.v1',patternId='pattern-1',rollDeg=12))
                if low_null:t.update(gainDbi=50,powerDbm=-10,lossDb=40)
                ports.append(dict(linkId=link,radioId='radio-1',radioPortId=radio_port,antennaPortId=antenna_port,antennaId='antenna-1',template=t))
            tx=dict(id='CELL:cell-1',site_id='TEST-SITE',label='Frozen site A / NR cell',cellId='cell-1',cellIdentity='NR cell',rat='NR',coordinates=[-79.4,43.7],frequency_mhz=3600,ports=ports)
            snap['transmitters']=[tx]
        if model==PATTERN_UMA:
            snap['inventorySnapshot']=dict(operatorEquipment=dict(revision=1,sha256=sha,raw=raw))
            snap['patternModels']=[dict(p,equipmentRevision=1,equipmentSha256=sha) for p in pattern_summaries(data)]
            snap['patternAssumptions']={'format':'ndt.scalar-gain-grid.v1'}
        for variant,delta in [('A',0),('B',2)]:
            powers={tx['id']:(46 if model==LEGACY_UMA else cell_eirp(tx) if source else peak_eirp(a))+delta}
            case=dict(id='speed-60',name='60 km/h',speedKmh=60)
            context=dict(deepcopy(snap),model=model,case=case,powers=powers,mode='NLOS' if model==LEGACY_UMA else 'per-template',interval_s=5,rat='NR',experiment_id='EXP-'+model+suffix,variant=variant)
            rows=simulate(snap,case,powers,interval_s=5,rat='NR',mode='NLOS',time_origin=snap['time_origin'],cancelled=lambda:False)
            result.append(dict(id=model+suffix+'-'+variant,kind='simulated',sha256='a'*64,scope=dict(region_id='toronto',project_id='p',task_id='task'),context=context,rows=rows))
    # Paired radio revisions can move a site into/out of the selected RAT.
    common=dict(id='SNAP-membership',predictionModel=DIRECTIONAL_UMA,route=deepcopy(snap['route']),time_origin=1700000000000,
                scope=dict(region_id='toronto',project_id='p',task_id='task'),radioScenario=dict(id='membership',revision=1,payload={}))
    for variant in ['A','B']:
        members=[]
        for i in range(2):
            t=deepcopy(BASE);selected=(i==0)==(variant=='A');t.update(rat='NR' if selected else 'LTE',frequencyMHz=3600 if selected else 2130,bandwidthMHz=100 if selected else 20)
            members.append(dict(id='site-'+str(i),site_id='SITE-'+str(i),label='Frozen site '+str(i),coordinates=[-79.4-.0005*i,43.7+.005*i],frequency_mhz=t['frequencyMHz'],template=t))
        frozen=dict(deepcopy(common),transmitters=members);powers={t['id']:peak_eirp(t['template']) for t in members};case=dict(id='speed-60',name='60 km/h',speedKmh=60)
        context=dict(frozen,model=DIRECTIONAL_UMA,case=case,powers=powers,mode='per-template',interval_s=5,rat='NR',experiment_id='EXP-membership',variant=variant)
        rows=simulate(frozen,case,powers,interval_s=5,rat='NR',mode='NLOS',time_origin=frozen['time_origin'],cancelled=lambda:False)
        result.append(dict(id='membership-'+variant,kind='simulated',sha256='b'*64,scope=common['scope'],context=context,rows=rows))
    return result

if __name__=='__main__':print(json.dumps(vectors(),ensure_ascii=False))
