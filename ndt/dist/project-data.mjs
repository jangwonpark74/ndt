export const PROJECT_USE_CASES = [
  {id:'virtual-drive-test', name:'Virtual Drive Test'},
  {id:'parameter-ab-test', name:'Parameter A/B Test'},
  {id:'ai-ran-benchmark', name:'AI-RAN Algo. Benchmark'},
];
export const validProjectUseCase = value => value === null || PROJECT_USE_CASES.some(item=>item.id === value);
