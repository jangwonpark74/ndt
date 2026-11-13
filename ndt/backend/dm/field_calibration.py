"""A diagnostic offset fitted on earlier sites and evaluated on later, other sites.

Inputs are compatible, quality-screened observed-cell pairs. A fitted offset is a
study candidate, never an update to the frozen radio model or a field certificate.
"""
from collections import Counter,defaultdict
import math
import statistics

ALGORITHM='ndt.field-calibration.site-time-bins.v1'
MIN_BINS=30
MIN_SITES=2
COVARIATES=('rat','band','frequencyMHz','bandwidthMHz','environment')

def _number(value,low,high,label,integer=False):
    if type(value) not in (int,float) or not low<=value<=high or not math.isfinite(value) or integer and int(value)!=value:
        raise ValueError(f'{label} must be a finite {"integer" if integer else "number"} from {low} to {high}')
    return value

def _text(value,label):
    if not isinstance(value,str) or not 1<=len(value)<=200 or any(ord(c)<32 for c in value):
        raise ValueError(f'{label} must be nonempty plain text')
    return value

def _power_mean(values):
    top=max(values)
    return top+10*math.log10(math.fsum(10**((v-top)/10) for v in values)/len(values))

def _stats(values):
    if not values:return None
    return dict(bins=len(values),biasDb=statistics.mean(values),maeDb=statistics.mean(abs(x) for x in values),
                rmseDb=math.sqrt(statistics.mean(x*x for x in values)))

def _support(row):return tuple(row[k] for k in COVARIATES)

def fit_holdout(rows,*,cutoff_t,heldout_sites,gap_ms=60000):
    _number(cutoff_t,-9007199254740991,9007199254740991,'UTC cutoff',True)
    _number(gap_ms,0,86400000,'Time gap',True)
    if not isinstance(heldout_sites,list) or not heldout_sites or any(not isinstance(s,str) for s in heldout_sites) or len(heldout_sites)!=len(set(heldout_sites)):
        raise ValueError('Choose distinct physical site IDs for the holdout')
    heldout=set(_text(s,'Holdout site ID') for s in heldout_sites)
    if not isinstance(rows,list) or len(rows)>100000:raise ValueError('Use at most 100000 compatible observations')
    groups=defaultdict(list);quarantine=Counter()
    for index,row in enumerate(rows):
        if not isinstance(row,dict):raise ValueError('Each compatible observation must be an object')
        for key in ('siteId','cellId','band'):_text(row.get(key),key)
        if row.get('rat') not in ('LTE','NR') or row.get('environment') not in ('LOS','NLOS'):
            raise ValueError('Each pair needs its frozen RAT and propagation environment')
        for key,low,high,integer in [('t',-9007199254740991,9007199254740991,True),('chainageM',0,1e12,False),
                ('frequencyMHz',500,100000,False),('bandwidthMHz',.1,400,False),
                ('measuredDbm',-300,90,False),('predictedDbm',-300,90,False)]:
            _number(row.get(key),low,high,key,integer)
        t=row['t'];site=row['siteId']
        if cutoff_t-gap_ms<=t<cutoff_t+gap_ms:quarantine['time-gap']+=1;continue
        if site in heldout and t<cutoff_t:quarantine['heldout-site-before-cutoff']+=1;continue
        if site not in heldout and t>=cutoff_t:quarantine['training-site-after-cutoff']+=1;continue
        split='holdout' if site in heldout else 'training'
        key=(split,site,row['cellId'],*_support(row),math.floor(row['chainageM']/20))
        groups[key].append((index,row))
    bins=[]
    for key,items in sorted(groups.items()):
        split,site,cell,*rest=key;first=items[0][1]
        measured=_power_mean([r['measuredDbm'] for _,r in items]);predicted=_power_mean([r['predictedDbm'] for _,r in items])
        bins.append(dict(partition=split,siteId=site,cellId=cell,**{k:first[k] for k in COVARIATES},
            chainageM=key[-1]*20,samples=len(items),indices=[i for i,_ in items],
            start=min(r['t'] for _,r in items),end=max(r['t'] for _,r in items),
            measuredDbm=measured,predictedDbm=predicted,residualDb=measured-predicted))
    training=[b for b in bins if b['partition']=='training'];holdout=[b for b in bins if b['partition']=='holdout']
    train_sites={b['siteId'] for b in training};support={_support(b) for b in training}
    enough_training=len(training)>=MIN_BINS and len(train_sites)>=MIN_SITES
    offset=statistics.mean(b['residualDb'] for b in training) if enough_training else None
    scored=[b for b in holdout if _support(b) in support]
    score_sites={b['siteId'] for b in scored}
    enough_holdout=len(scored)>=MIN_BINS and len(score_sites)>=MIN_SITES
    status='insufficient-training' if not enough_training else 'insufficient-holdout' if not enough_holdout else 'diagnostic-complete'
    for i,b in enumerate(bins):
        b['index']=i;b['adjustedResidualDb']=b['residualDb']-offset if offset is not None and _support(b) in support else None
    def breakdown(keys,source):
        parts=defaultdict(list)
        for b in source:parts[tuple(b[k] for k in keys)].append(b)
        result=[]
        for values,part in sorted(parts.items()):
            paired=[b for b in part if b['adjustedResidualDb'] is not None]
            result.append(dict(zip(keys,values),bins=len(part),sites=len({b['siteId'] for b in part}),
                raw=_stats([b['residualDb'] for b in part]),pairedRaw=_stats([b['residualDb'] for b in paired]),
                adjusted=_stats([b['adjustedResidualDb'] for b in paired]),unscoredBins=len(part)-len(paired)))
        return result
    return dict(schema=ALGORITHM,status=status,offsetDb=offset,cutoffT=cutoff_t,timeGapMs=gap_ms,
        heldoutSites=sorted(heldout),binM=20,minimumBins=MIN_BINS,minimumSites=MIN_SITES,
        training=dict(bins=len(training),sites=len(train_sites),raw=_stats([b['residualDb'] for b in training])),
        holdout=dict(bins=len(scored),totalBins=len(holdout),sites=len(score_sites),
            raw=_stats([b['residualDb'] for b in scored]),allRaw=_stats([b['residualDb'] for b in holdout]),
            adjusted=_stats([b['adjustedResidualDb'] for b in scored]) if offset is not None else None),
        unscoredHoldoutBins=len(holdout)-len(scored),quarantined=sum(quarantine.values()),quarantineReasons=dict(quarantine),
        bins=bins,byCarrier=breakdown(['rat','band','frequencyMHz','bandwidthMHz'],holdout),
        byEnvironment=breakdown(['environment'],holdout),bySite=breakdown(['partition','siteId'],bins),
        limitations='Equal 20 m cell/carrier bins, linear-power averaging before dB residuals. Offset uses training bins only. '
        'A global diagnostic offset does not calibrate model shape or certify field accuracy. Holdout sites/times are disjoint; '
        'spatially correlated sites and repeated study selection can still bias validation. No confidence interval or model deployment.')
