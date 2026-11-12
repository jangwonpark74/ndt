import assert from 'node:assert/strict';
import {RADIO_DEFAULTS, umaPathLoss, coverageRadius} from '../../dist/radio-model.mjs';

assert.ok(Math.abs(umaPathLoss(100,2000,'LOS')-78.2773957031) < 1e-8, '3GPP UMa LOS before breakpoint');
assert.ok(Math.abs(umaPathLoss(100,2000,'NLOS')-98.1767626163) < 1e-8, '3GPP UMa NLOS uses the larger loss');
assert.ok(Math.abs(umaPathLoss(1000,2000,'NLOS')-136.8052850763) < 1e-8, '3GPP UMa NLOS after breakpoint');
assert.ok(Math.abs(umaPathLoss(319.999,2000,'LOS')-umaPathLoss(320.001,2000,'LOS')) < .001, 'LOS is continuous at breakpoint');
assert.equal(umaPathLoss(9,2000,'LOS'),null);
assert.equal(umaPathLoss(5001,2000,'LOS'),null);
assert.equal(umaPathLoss(100,499,'LOS'),null);
assert.equal(umaPathLoss(100,2000,'invalid'),null);
const low = coverageRadius(700), high = coverageRadius(3500);
assert.ok(low.radiusM > high.radiusM, 'lower frequency reaches farther for the same assumed link budget');
assert.ok(Math.abs(umaPathLoss(low.radiusM,700,RADIO_DEFAULTS.mode)-(RADIO_DEFAULTS.eirpDbm-RADIO_DEFAULTS.thresholdDbm)) < 1e-8);
assert.equal(coverageRadius(700,{mode:'LOS',eirpDbm:90,thresholdDbm:-160}).status,'capped-at-5km');
assert.deepEqual(coverageRadius(3500,{mode:'NLOS',eirpDbm:0,thresholdDbm:-20}),{radiusM:0,status:'below-model-range'});
assert.equal(coverageRadius(700,{mode:'NLOS',eirpDbm:NaN,thresholdDbm:-100}),null);
console.log('3GPP UMa planning path-loss and link-budget tests passed.');
