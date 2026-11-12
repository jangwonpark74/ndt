const {execFileSync}=require('node:child_process');
let executable;
function fixturePython(){
  // Windows venv launchers can leave a second interpreter holding SQLite files.
  if(!executable)executable=execFileSync(process.env.PYTHON || 'python3',['-c','import sys; print(sys._base_executable)'],{encoding:'utf8'}).trim();
  return executable;
}
module.exports={fixturePython};
