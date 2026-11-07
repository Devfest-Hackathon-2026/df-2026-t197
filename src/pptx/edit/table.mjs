import { child, children, at, attr } from '../xml.mjs';
import { findShape } from './text.mjs';
import { replaceParagraph } from './paragraph.mjs';

export function replaceTableCellParagraph(root, operation) {
  const frame=findShape(root,operation.shape,'graphicFrame');
  const table=at(frame,['a','graphic'],['a','graphicData'],['a','tbl']);
  if(!table) throw new Error('TARGET_NOT_FOUND: native table');
  const width=children(child(table,'a','tblGrid'),'a','gridCol').length;
  const rows=children(table,'a','tr');
  if(!width||!rows.length||rows.some(row=>children(row,'a','tc').length!==width)) throw new Error('UNSUPPORTED_TABLE_GRID');
  for(const row of rows) for(const cell of children(row,'a','tc')) {
    if(['gridSpan','rowSpan'].some(name=>attr(cell,name)!==null&&attr(cell,name)!=='1') || ['hMerge','vMerge'].some(name=>attr(cell,name)!==null&&!['0','false'].includes(attr(cell,name)))) throw new Error('UNSUPPORTED_MERGED_TABLE: no implicit cell coordinates');
  }
  const cell=children(rows[operation.row],'a','tc')[operation.column];
  if(!cell) throw new Error('TARGET_NOT_FOUND: table cell');
  return replaceParagraph(child(cell,'a','txBody'),operation);
}
