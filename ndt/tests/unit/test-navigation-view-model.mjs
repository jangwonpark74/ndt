import assert from 'node:assert/strict';
import {createNavigationViewModel} from '../../dist/navigation-view-model.mjs';

const vm = createNavigationViewModel(), states = [];
const unsubscribe = vm.subscribe(state=>states.push(state.open));
vm.setOpen(true);
assert.equal(vm.getState().open,true);
vm.setOpen(false);
unsubscribe();
vm.setOpen(true);
assert.deepEqual(states,[false,true,false]);
console.log('Mobile navigation view-model passed.');
