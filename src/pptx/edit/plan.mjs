import Ajv from 'ajv';
import { assertXmlStrings } from '../../xml-text.mjs';
const ref = {oneOf:[{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',pattern:'^[0-9]+$'}}},{type:'object',additionalProperties:false,required:['alias'],properties:{alias:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'}}}]};
const shape={type:'object',additionalProperties:false,required:['id','parents'],properties:{id:{type:'string',pattern:'^[0-9]+$'},parents:{type:'array',maxItems:32,items:{type:'string',pattern:'^[0-9]+$'}}}};
const paragraphProperties={op:{const:'replace-paragraph-text'},slide:ref,shape,paragraph:{type:'integer',minimum:0,maximum:10000},expectedText:{type:'string',maxLength:100000},text:{type:'string',maxLength:100000},styleFromRun:{type:'integer',minimum:0,maximum:10000}};
const boxProperties={xEmu:{type:'integer',minimum:0,maximum:2147483647},yEmu:{type:'integer',minimum:0,maximum:2147483647},widthEmu:{type:'integer',minimum:1,maximum:2147483647},heightEmu:{type:'integer',minimum:1,maximum:2147483647}};
const imageProperties={alt:{type:'string',maxLength:2000},data:{type:'string',minLength:1,maxLength:11000000},box:{type:'object',additionalProperties:false,required:Object.keys(boxProperties),properties:boxProperties}};
const schema = {type:'object',additionalProperties:false,required:['version','sourceSha256','operations'],properties:{
  version:{const:1},sourceSha256:{type:'string',pattern:'^[a-fA-F0-9]{64}$'},operations:{type:'array',minItems:1,maxItems:100,items:{oneOf:[
    {type:'object',additionalProperties:false,required:['op','slide','shape'],properties:{op:{const:'delete-shape'},slide:ref,shape}},
    {type:'object',additionalProperties:false,required:['op','slide','shape','fontFace','fontSizePt'],properties:{op:{const:'set-text-style'},slide:ref,shape,fontFace:{type:'string',minLength:1,maxLength:100},fontSizePt:{type:'number',minimum:8,maximum:96,multipleOf:0.5},removeBullets:{type:'boolean'},alignment:{enum:['left','center','right']}}},
    {type:'object',additionalProperties:false,required:['op','slide','shape',...Object.keys(boxProperties)],properties:{op:{const:'set-shape-position'},slide:ref,shape,...boxProperties}},
    {type:'object',additionalProperties:false,required:['op','slide','shape','data','box'],properties:{op:{const:'replace-image'},slide:ref,shape,...imageProperties}},
    {type:'object',additionalProperties:false,required:['op','slide','data','box','alt'],properties:{op:{const:'add-image'},slide:ref,...imageProperties,alt:{...imageProperties.alt,minLength:1}}},
    {type:'object',additionalProperties:false,required:['op','slide','expectedText','paragraphs'],properties:{op:{const:'set-speaker-notes'},slide:ref,expectedText:{type:'string',maxLength:100000},paragraphs:{type:'array',minItems:1,maxItems:100,items:{type:'string',maxLength:10000}}}},
    {type:'object',additionalProperties:false,required:['op','slide','as','after'],properties:{op:{const:'duplicate-slide'},slide:ref,as:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'},after:ref}},
    {type:'object',additionalProperties:false,required:['op','slide'],properties:{op:{const:'delete-slide'},slide:ref}},
    {type:'object',additionalProperties:false,required:['op','slides'],properties:{op:{const:'reorder-slides'},slides:{type:'array',minItems:1,maxItems:1000,items:ref}}},
    {type:'object',additionalProperties:false,required:['op','slide','xEmu','yEmu','widthEmu','heightEmu','paragraphs','fontFace','fontSizePt','color'],properties:{op:{const:'add-text-shape'},slide:ref,xEmu:{type:'integer',minimum:0},yEmu:{type:'integer',minimum:0},widthEmu:{type:'integer',minimum:1},heightEmu:{type:'integer',minimum:1},paragraphs:{type:'array',minItems:1,maxItems:100,items:{type:'string',maxLength:12000}},fontFace:{type:'string',minLength:1,maxLength:100},fontSizePt:{type:'number',minimum:8,maximum:96,multipleOf:0.5},color:{type:'string',pattern:'^[a-fA-F0-9]{6}$'}}},
    {type:'object',additionalProperties:false,required:['op','slide','shape','paragraph','run','expectedText','text'],properties:{op:{const:'replace-run-text'},slide:ref,shape,paragraph:{type:'integer',minimum:0,maximum:10000},run:{type:'integer',minimum:0,maximum:10000},expectedText:{type:'string',maxLength:100000},text:{type:'string',maxLength:100000}}},
    {type:'object',additionalProperties:false,required:['op','slide','shape','paragraph','expectedText','text'],properties:paragraphProperties},
    {type:'object',additionalProperties:false,required:['op','slide','shape','paragraph','styleFromParagraph','expectedText','text'],properties:{...paragraphProperties,op:{const:'insert-paragraph'},styleFromParagraph:{type:'integer',minimum:0,maximum:10000}}},
    {type:'object',additionalProperties:false,required:['op','slide','shape','paragraph','expectedText'],properties:{op:{const:'delete-paragraph'},slide:ref,shape,paragraph:{type:'integer',minimum:0,maximum:10000},expectedText:{type:'string',maxLength:100000}}},
    {type:'object',additionalProperties:false,required:['op','layoutPart','as','after','placeholders'],properties:{op:{const:'add-slide-from-layout'},layoutPart:{type:'string',minLength:1,maxLength:1024},as:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'},after:ref,placeholders:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['idx','paragraphs'],properties:{idx:{type:'integer',minimum:0,maximum:4294967295},paragraphs:{type:'array',minItems:1,maxItems:100,items:{oneOf:[{type:'string',maxLength:100000},{type:'object',additionalProperties:false,required:['text','level'],properties:{text:{type:'string',maxLength:100000},level:{type:'integer',minimum:0,maximum:8}}}]}}}}}}},
    {type:'object',additionalProperties:false,required:['op','slide','shape','row','column','paragraph','expectedText','text'],properties:{...paragraphProperties,op:{const:'replace-table-cell-paragraph'},row:{type:'integer',minimum:0,maximum:10000},column:{type:'integer',minimum:0,maximum:10000}}}
  ]}}
}};
const validate = new Ajv({allErrors:true,strict:true}).compile(schema);
export function validateEditPlan(plan) {
  if(!validate(plan)) throw new Error(`INVALID_EDIT_PLAN: ${JSON.stringify(validate.errors)}`);
  for(const op of plan.operations) {
    const texts=Object.hasOwn(op,'text')?[op.text]:op.paragraphs??(op.placeholders??[]).flatMap(p=>p.paragraphs.map(item=>typeof item==='string'?item:item.text));
    for(const text of texts) if(!text.isWellFormed() || /[\u0000-\u001f\ufffe\uffff]/u.test(text)) throw new Error('UNSUPPORTED_TEXT_CONTROL: require valid XML text without line breaks');
  }
  assertXmlStrings(plan);
  return plan;
}
