import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
export async function readPdf(source, output, plan) {
  const executable=process.env.SLIDES_PYTHON||'python';
  const args=[fileURLToPath(new URL('./read.py',import.meta.url)),source,output,...(plan?['--plan',plan]:[])];
  try {
    const {stdout}=await execute(executable,args,{timeout:180000,maxBuffer:1024*1024,windowsHide:true,encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
    return JSON.parse(stdout);
  } catch(error) {throw new Error(`PDF_READ_FAILED: ${error.stderr?.trim()||error.message}`);}
}
