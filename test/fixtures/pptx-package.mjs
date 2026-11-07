// Independently authored synthetic OPC package. No user material or vendor skill code.
import JSZip from 'jszip';
import { NS } from '../../src/pptx/xml.mjs';
export async function fixture({strict=false, mutate=()=>{}} = {}) {
  const n = strict ? 1 : 0;
  const ns = `xmlns:p="${NS.p[n]}" xmlns:a="${NS.a[n]}" xmlns:r="${NS.r[n]}" xmlns:c="${NS.c[n]}" xmlns:mc="urn:test:unsupported"`;
  const rels = entries => `<Relationships xmlns="${NS.rel[0]}">${entries.map(([id,kind,target,external]) => `<Relationship Id="${id}" Type="${NS.r[n]}/${kind}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  const shape = (id,text,ph='',props='',rpr='',list='') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="item${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${props}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle>${list}</a:lstStyle><a:p><a:r><a:rPr ${rpr}/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const xfrm = '<a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm>';
  const tree = body => `<p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${body}</p:spTree></p:cSld>`;
  const files = {
    '[Content_Types].xml':`<Types xmlns="${NS.ct[0]}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${['3','9','7'].map(i=>`<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`,
    '_rels/.rels':rels([['doc','officeDocument','ppt/presentation.xml']]),
    'ppt/presentation.xml':`<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="300" r:id="nine"/><p:sldId id="301" r:id="three"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels':rels([['nine','slide','slides/slide9.xml'],['three','slide','slides/slide3.xml'],['master','slideMaster','slideMasters/master.xml']]),
    'ppt/slideMasters/master.xml':`<p:sldMaster ${ns}>${tree(shape(1,'master sample','<p:ph type="title"/>','', '','<a:lvl1pPr><a:defRPr sz="3200" b="1"><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr>'))}<p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="layout"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/master.xml.rels':rels([['layout','slideLayout','../slideLayouts/layout.xml'],['theme','theme','../theme/theme.xml']]),
    'ppt/slideLayouts/layout.xml':`<p:sldLayout ${ns}>${tree(shape(2,'layout sample','<p:ph type="title" idx="7"/>',xfrm,'','<a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr>'))}</p:sldLayout>`,
    'ppt/slideLayouts/_rels/layout.xml.rels':rels([['master','slideMaster','../slideMasters/master.xml']]),
    'ppt/theme/theme.xml':`<a:theme ${ns} name="synthetic"><a:themeElements><a:fontScheme name="test"><a:majorFont><a:latin typeface="Test Major"/></a:majorFont><a:minorFont><a:latin typeface="Test Minor"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    'ppt/slides/slide9.xml':`<p:sld ${ns}>${tree(shape(5,' first ','<p:ph idx="7"/>','','b="0"') + `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="2000" cy="3000"/><a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>${shape(7,'group child','',xfrm)}</p:grpSp><p:pic><p:nvPicPr><p:cNvPr id="8"/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:link="remote"/></p:blipFill></p:pic><mc:AlternateContent/>`)}</p:sld>`,
    'ppt/slides/_rels/slide9.xml.rels':rels([['layout','slideLayout','../slideLayouts/layout.xml'],['remote','image','https://example.invalid/not-fetched.png',true],['notes','notesSlide','../notesSlides/notes.xml']]),
    'ppt/slides/slide3.xml':`<p:sld ${ns} show="0">${tree(shape(5,'second'))}</p:sld>`,
    'ppt/slides/_rels/slide3.xml.rels':rels([['layout','slideLayout','../slideLayouts/layout.xml']]),
    'ppt/slides/slide7.xml':`<p:sld ${ns}>${tree(shape(5,'orphan'))}</p:sld>`,
    'ppt/notesSlides/notes.xml':`<p:notes ${ns}>${tree(shape(1,'speaker note','<p:ph type="body"/>')+shape(2,'99','<p:ph type="sldNum"/>'))}</p:notes>`
  };
  mutate(files);
  const zip = new JSZip();
  for (const [part,xml] of Object.entries(files)) zip.file(part,xml,{createFolders:false});
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
