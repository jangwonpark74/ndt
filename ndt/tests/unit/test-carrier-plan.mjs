import assert from 'node:assert/strict';
import {carrierFrequency,validateCarrier,CARRIER_PLAN} from '../../dist/carrier-plan.mjs';
const lte={rat:'LTE',frequencyMHz:2140,bandwidthMHz:20,carrier:{standard:'3gpp-rel18-carrier-subset-v1',band:'B4',channel:2250,scsKHz:15}};
const nr={rat:'NR',frequencyMHz:3600,bandwidthMHz:100,carrier:{standard:'3gpp-rel18-carrier-subset-v1',band:'n78',channel:640000,scsKHz:30}};
assert.equal(validateCarrier(lte),'');assert.equal(validateCarrier(nr),'');
assert.equal(carrierFrequency('B4',2250),2140);assert.equal(carrierFrequency('n78',640000),3600);
assert.equal(validateCarrier({...nr,carrier:undefined}),'');
assert.match(validateCarrier({...nr,carrier:undefined},true),/Choose a supported band/);
for(const [input,message] of [
 [{...lte,frequencyMHz:2100},/2140 MHz/],
 [{...lte,bandwidthMHz:100},/bandwidth/],
 [{...lte,carrier:{...lte.carrier,band:'n78'}},/RAT/],
 [{...nr,carrier:{...nr.carrier,channel:640001}},/channel raster/],
 [{...nr,carrier:{...nr.carrier,channel:620000},frequencyMHz:3300},/band edge/],
 [{...nr,carrier:{...nr.carrier,scsKHz:15}},/SCS/],
 [{...nr,carrier:{...nr.carrier,standard:'new-version'}},/version/],
 [{...nr,carrier:{...nr.carrier,channel:true}},/integer/],
 [{...nr,carrier:{...nr.carrier,band:'n999'}},/supported band/]
])assert.match(validateCarrier(input),message);
assert.equal(CARRIER_PLAN.bands.length,6);
console.log('Carrier plan release, channel raster, band edge, bandwidth and legacy validation passed.');
