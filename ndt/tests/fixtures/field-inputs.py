"""Declared software-test contracts only; these are not real field measurements."""
from copy import deepcopy
from datetime import datetime
import importlib.util,json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.dm.integration import digest

def field_inputs():
    spec=importlib.util.spec_from_file_location('field_contract_vectors',Path(__file__).with_name('rf-review-vectors.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);runs=module.vectors()
    prediction=deepcopy(next(r for r in runs if r['context']['model']=='uma-source-cells-fixed-heights-v4'))
    grid=next(r for r in runs if r['context']['model']=='uma-source-patterns-fixed-heights-v5')
    context=prediction['context'];context['inventorySnapshot']=deepcopy(grid['context']['inventorySnapshot'])
    context['geometry_hash']=digest(context['route']['coordinates'])
    for p in context['transmitters'][0]['ports']:
        p['template']['carrier']=dict(standard='3gpp-rel18-carrier-subset-v1',band='n78',channel=640000,scsKHz=30)
    prediction['sha256']=digest(dict(manifest=context,rows=prediction['rows']))
    t=int(datetime.fromisoformat('2026-11-02T12:00:00+00:00').timestamp()*1000)
    capture=dict(id='fixture-capture',label='Software fixture, not field data',kind='imported',sha256='b'*64,
        scope=deepcopy(prediction['scope']),start=t,end=t+39000,
        rows=[dict(t=t+i*1000,rat='NR',band='n78',arfcn=640000,cell_id='observed-cell',
            latitude=43.71+i*.00001,longitude=-79.4,measured_rx_dbm=-80,measurement_status='valid') for i in range(40)])
    descriptor=dict(schema='ndt.field-measurement.v1',captureSha256=capture['sha256'],predictionSha256=prediction['sha256'],
        equipmentSha256=context['inventorySnapshot']['operatorEquipment']['sha256'],geometryHash=context['geometry_hash'],
        provenance=dict(origin='operator-measurement',recordId='software-contract-test-not-real',uri='urn:ndt:software-test-only'),
        instrument=dict(id='fixture-receiver',calibrationRecordId='fixture-calibration-not-real',calibratedAt='2026-10-01T00:00:00Z',validUntil='2026-12-01T00:00:00Z',minimumDbm=-150,maximumDbm=20),
        measurement=dict(quantity='desired-carrier-local-mean-power',column='measured_rx_dbm',unit='dBm',
            referencePlane='ndt.zero-gain-receiver.v1',averaging='linear-power-local-mean',averagingWindowM=20,
            bsHeightM=25,ueHeightM=1.5,receiver={'model':'ndt.receiver.scalar-ideal.v1'}),
        configuration=dict(sourceId='test-operator',recordId='fixture-frozen-config-match',matched=True,
            validFrom='2026-11-01T00:00:00Z',validUntil='2026-11-03T00:00:00Z'),
        cells=[dict(captureCellId='observed-cell',transmitterId='CELL:cell-1',rat='NR',band='n78',arfcn=640000,frequencyMHz=3600,bandwidthMHz=100)])
    return capture,prediction,descriptor

def multisite_inputs(rat='NR'):
    """Four physical sites with an analytic 3 dB train / 6 dB holdout bias.

    Everything in this contract is fabricated for testing. It supplies no
    independent field/model accuracy evidence.
    """
    from backend.dm.field_prediction import prepare_field_predictor
    from backend.dm.simulation import simulate
    from backend.cell_assignments import cell_eirp
    import hashlib
    capture,prediction,descriptor=field_inputs();context=prediction['context']
    scope=dict(region_id='toronto',project_id='field-software-test',task_id='fixture-'+rat,region='Toronto',project='Software field-workflow fixture',task='Not real measured data')
    capture['scope']=deepcopy(scope);prediction['scope']=deepcopy(scope);context['scope']=deepcopy(scope)
    base=json.loads(context['inventorySnapshot']['operatorEquipment']['raw'].removeprefix('\ufeff'))
    base['ports']=base['ports'][:2];base['links']=base['links'][:1]
    collections=['sites','sectors','radios','antennas','cells','ports','links','patterns']
    data=dict(schemaVersion=base['schemaVersion'],sources=base['sources'],**{k:[] for k in collections})
    original=context['transmitters'][0];context['transmitters']=[]
    frequency,bandwidth,band,channel=(3600,100,'n78',640000) if rat=='NR' else (2140,20,'B1',300)
    for i in range(4):
        prefix=f's{i}-';ids={r['id']:prefix+r['id'] for k in collections for r in base[k]}
        for key in collections:
            for row in base[key]:
                row={k:ids.get(v,v) if isinstance(v,str) else deepcopy(v) for k,v in row.items()}
                if key=='sites':row.update(inventorySiteId=f'SITE-{i}',name=f'Software fixture site {i}')
                if key=='cells':row.update(rat=rat,frequencyMHz=frequency,bandwidthMHz=bandwidth)
                data[key].append(row)
        tx=deepcopy(original);tx.update(id='CELL:'+ids['cell-1'],cellId=ids['cell-1'],cellIdentity=f'cell-{i}',site_id=f'SITE-{i}',
            label=f'Software fixture site {i} / {rat}',coordinates=[-79.4,43.7+i*.02],rat=rat,frequency_mhz=frequency)
        tx['ports']=tx['ports'][:1]
        for p in tx['ports']:
            for k in ['linkId','radioId','radioPortId','antennaPortId','antennaId']:p[k]=ids[p[k]]
            template=p['template'];template.update(rat=rat,frequencyMHz=frequency,bandwidthMHz=bandwidth)
            template['carrier']=dict(standard='3gpp-rel18-carrier-subset-v1',band=band,channel=channel,**({'scsKHz':30} if rat=='NR' else {}))
            template['equipmentSource'].update(cellId=tx['cellId'],linkId=p['linkId'])
        context['transmitters'].append(tx)
    raw=json.dumps(data,ensure_ascii=False);sha=hashlib.sha256(raw.encode()).hexdigest()
    context['inventorySnapshot']['operatorEquipment'].update(raw=raw,sha256=sha)
    for tx in context['transmitters']:
        tx['ports'][0]['template']['equipmentSource']['sha256']=sha
    context['radioScenario']['payload']['radioBudgets']={f's{i}-radio-1':40 for i in range(4)}
    context['powers']={t['id']:cell_eirp(t) for t in context['transmitters']};context['rat']=rat
    context['route']['coordinates']=[[-79.4,43.705],[-79.4,43.78]]
    context['geometry_hash']=digest(context['route']['coordinates'])
    prediction['rows']=simulate(context,context['case'],context['powers'],interval_s=context['interval_s'],rat=rat,
        mode=context['mode'],time_origin=context['time_origin'],cancelled=lambda:False)
    prediction['sha256']=digest(dict(manifest=context,rows=prediction['rows']))
    prepared=prepare_field_predictor(context);start=capture['start'];capture['rows']=[];mappings=[]
    for i,tx in enumerate(context['transmitters']):
        mappings.append(dict(captureCellId=f'observed-{i}',transmitterId=tx['id'],rat=rat,band=band,arfcn=channel,frequencyMHz=frequency,bandwidthMHz=bandwidth))
        for j in range(32):
            coordinates=[-79.4,43.705+i*.02+j*.0002]
            predicted=prepared.at(tx['id'],coordinates)['rxDbm']
            capture['rows'].append(dict(t=start+i*120000+j*1000,rat=rat,band=band,arfcn=channel,cell_id=f'observed-{i}',
                latitude=coordinates[1],longitude=coordinates[0],measured_rx_dbm=predicted+(3 if i<2 else 6),measurement_status='valid'))
    capture['end']=capture['rows'][-1]['t']
    descriptor.update(predictionSha256=prediction['sha256'],equipmentSha256=sha,geometryHash=context['geometry_hash'],cells=mappings)
    options=dict(cutoffT=start+180000,heldoutSites=['SITE-2','SITE-3'],timeGapMs=0,direction='forward',toleranceM=50,gapMs=10000,minimumCompatiblePct=90)
    return capture,prediction,descriptor,options

def large_inputs():
    capture,prediction,descriptor,options=multisite_inputs()
    rows=[]
    for i,row in enumerate(capture['rows']):
        for repeat in range(782 if i<32 else 781):rows.append(dict(row,t=row['t']+repeat))
    capture['id']='FIELD-FIXTURE-LARGE';capture['rows']=rows;capture['end']=rows[-1]['t'];capture['sha256']=digest(rows)
    descriptor['captureSha256']=capture['sha256']
    return capture,prediction,descriptor,options

def seed_field_tests(path,large=False):
    """Seed disposable UI databases only, never the user's served registry."""
    from backend.dm.dm_model import connection
    from backend.dm.integration import canonical
    import uuid,zlib
    with connection(path) as db:
        cases=[multisite_inputs(rat) for rat in ['NR','LTE']]
        if large:cases.append(large_inputs())
        for capture,prediction,descriptor,options in cases:
            rat=prediction['context']['rat'];large_case=len(capture['rows'])==100000
            if not large_case:capture['id']='FIELD-FIXTURE-'+rat
            prediction['id']='FIELD-MODEL-'+rat
            for test in [capture,prediction]:
                if large_case and test is prediction:continue
                rows=test['rows'];db.execute('INSERT INTO tests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',(test['id'],str(uuid.uuid4()),canonical(test['scope']),f'{rat} software contract / not real field data',
                    'Fabricated workflow test; no physical validation','software-test-only.csv',test['sha256'],test['kind'],'2026-11-02T00:00:00Z',rows[0]['t'],rows[-1]['t'],len(rows),zlib.compress(canonical(rows).encode())))
                if 'context' in test:db.execute('INSERT INTO test_contexts VALUES (?,?,NULL)',(test['id'],canonical(test['context'])))

if __name__=='__main__':print(json.dumps(field_inputs()))
