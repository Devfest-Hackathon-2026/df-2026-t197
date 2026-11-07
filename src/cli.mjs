import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDeck, hash } from './renderer.mjs';
import { validateDeck, lintDeck } from './schema.mjs';
import { inspectPptx } from './inspect.mjs';
import { patchDeck } from './patch.mjs';
import { readPptxFile } from './pptx/read/index.mjs';
import { checkTemplate } from './pptx/check-template.mjs';
import { editPptx } from './pptx/edit/index.mjs';
import { saveEditedPptx } from './pptx/edit/save.mjs';
import {readPdf} from './pdf/bridge.mjs';
import {renderPaper} from './pdf/paper.mjs';

const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
async function assertNew(p) { try { await fs.access(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; } throw new Error(`Refusing to overwrite: ${p}`); }
async function main() {
  const [command, input, arg, extra] = process.argv.slice(2);
  if (command === 'render' && input && arg && !extra) {
    const output = path.resolve(arg), reportPath = `${output}.report.json`;
    await assertNew(output); await assertNew(reportPath);
    const source = await readJson(input);
    const { buffer, report } = await renderDeck(source, { assetRoot: path.dirname(path.resolve(input)) });
    report.structure = await inspectPptx(buffer);
    if (report.structure.status !== 'passed') throw new Error(`PPTX structure failed: ${report.structure.errors.join('; ')}`);
    report.createdAt = new Date().toISOString();
    report.generatorHash = hash(await fs.readFile(new URL('./renderer.mjs', import.meta.url)));
    report.codeHashes = {};
    for (const name of ['renderer.mjs', 'schema.mjs', 'xml-text.mjs', 'inheritance.mjs', 'inspect.mjs', 'pptx/package.mjs', 'pptx/xml.mjs', 'pptx/edit/save.mjs', 'cli.mjs']) report.codeHashes[name] = hash(await fs.readFile(new URL(`./${name}`, import.meta.url)));
    report.dependencyLockHash = hash(await fs.readFile(new URL('../package-lock.json', import.meta.url)));
    report.slideMap = source.slides.map((s, i) => ({ id: s.id, page: i + 1, elements: s.elements.map(e => e.id) }));
    const skillPath = fileURLToPath(new URL('../skills/research-slides/SKILL.md', import.meta.url));
    report.skill = { path: 'skills/research-slides/SKILL.md', sha256: hash(await fs.readFile(skillPath)), note: 'Hash identifies the file; it does not prove an agent read it.' };
    await saveEditedPptx(output, buffer, report);
    console.log(JSON.stringify({ output, reportPath, warnings: report.warnings.length }));
  } else if (command === 'validate' && input && !arg) {
    const deck = validateDeck(await readJson(input)); console.log(JSON.stringify({ status: 'passed', warnings: lintDeck(deck) }, null, 2));
  } else if (command === 'inspect' && input && !arg) {
    const result = await inspectPptx(await fs.readFile(input)); console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1;
  } else if (command === 'check-template' && input && arg && extra) {
    const review = await readJson(extra);
    const result = checkTemplate(await readPptxFile(input),await readPptxFile(arg),review);
    console.log(JSON.stringify(result,null,2));
    if (result.status !== 'passed') process.exitCode = 1;
  } else if (command === 'read' && input && arg && !extra) {
    await assertNew(arg);
    const result = await readPptxFile(input);
    await fs.mkdir(path.dirname(path.resolve(arg)), { recursive: true });
    await fs.writeFile(arg, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ output:path.resolve(arg),status:result.status,summary:result.summary,issues:result.issues.length }));
    if (result.status === 'partial') process.exitCode = 2;
  } else if (command === 'render-paper' && input && arg && extra) {
    await assertNew(extra);await assertNew(`${extra}.report.json`);
    const {buffer,report}=await renderPaper(await readJson(input),await readJson(arg),path.dirname(path.resolve(input)));
    console.log(JSON.stringify({...await saveEditedPptx(extra,buffer,report),slides:report.slideCount,status:'passed',evidenceChecks:'page anchors only'}));
  } else if (command === 'read-pdf' && input && arg) {
    console.log(JSON.stringify(await readPdf(input,arg,extra)));
  } else if (command === 'edit' && input && arg && extra) {
    await assertNew(extra);await assertNew(`${extra}.report.json`);
    const {buffer,report}=await editPptx(await fs.readFile(input),await readJson(arg));
    console.log(JSON.stringify({...await saveEditedPptx(extra,buffer,report),status:report.status,operations:report.operations.length}));
  } else if (command === 'patch' && input && arg && extra) {
    await assertNew(extra);
    const changed = patchDeck(await readJson(input), await readJson(arg));
    await fs.mkdir(path.dirname(path.resolve(extra)), { recursive: true });
    await fs.writeFile(extra, JSON.stringify(changed, null, 2), { flag: 'wx' }); console.log(`Wrote ${extra}`);
  } else throw new Error('Usage: node src/cli.mjs render input.json output.pptx | validate input.json | inspect file.pptx | check-template template.pptx result.pptx review.json | read input.pptx output.json | read-pdf input.pdf output-directory [regions.json] | render-paper paper-index.json plan.json output.pptx | edit input.pptx plan.json output.pptx | patch input.json patch.json output.json');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
