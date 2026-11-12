async function stopFixture(processHandle) {
  if (!processHandle.pid || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const stopped = new Promise(resolve => processHandle.once('exit', resolve));
  // Fixtures launch the base interpreter directly, so no process-tree enumeration is needed.
  processHandle.kill();
  await stopped;
}

module.exports = {stopFixture};
