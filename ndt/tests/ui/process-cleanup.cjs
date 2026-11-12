const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

async function stopFixture(processHandle) {
  if (!processHandle.pid || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const stopped = new Promise(resolve => processHandle.once('exit', resolve));
  if (process.platform === 'win32') {
    // A venv python.exe can start a second Python process holding SQLite files.
    try {
      await execFileAsync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f']);
    } catch (error) {
      if (processHandle.exitCode === null && processHandle.signalCode === null) throw error;
    }
  } else {
    processHandle.kill();
  }
  await stopped;
}

module.exports = {stopFixture};
