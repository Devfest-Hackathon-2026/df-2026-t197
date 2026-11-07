import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Validate in memory first, then stage on the same volume. Hard links publish without overwriting.
export async function saveEditedPptx(output, buffer, report) {
  output=path.resolve(output);const reportPath=`${output}.report.json`;
  for(const target of [output,reportPath]) {try{await fs.lstat(target);throw new Error('OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await fs.mkdir(path.dirname(output),{recursive:true});
  const temporary=`${output}.${crypto.randomUUID()}.tmp`,temporaryReport=`${temporary}.json`;
  let published=false,publishedReport=false;
  try {
    await fs.writeFile(temporary,buffer,{flag:'wx'});
    await fs.writeFile(temporaryReport,JSON.stringify(report,null,2),{flag:'wx'});
    await fs.link(temporaryReport,reportPath);publishedReport=true;
    await fs.link(temporary,output);published=true;
  } catch(error) {
    if(published) await fs.unlink(output);
    if(publishedReport) await fs.unlink(reportPath);
    throw error;
  } finally {
    for(const file of [temporary,temporaryReport]) await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  return {output,reportPath};
}
