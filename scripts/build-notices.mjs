import {readFile,readdir,writeFile} from 'node:fs/promises';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const sections=['Dripping software: AGPL-3.0-only. Complete application source: https://github.com/soapisnotfat/dripping\nRuntime components retain their own notices below. Imported PDFs, MusicXML, audio and takes retain their existing rights.'];
for(const [path,metadata] of Object.entries(lock.packages)){
  if(!path||metadata.dev||path.includes('/@types/'))continue;
  const pkg=JSON.parse(await readFile(path+'/package.json','utf8'));
  const names=(await readdir(path)).filter(n=>/^(license|licence|copying|notice)([.-]|$)/i.test(n));
  const texts=[];
  for(const name of names){try{texts.push(await readFile(path+'/'+name,'utf8'));}catch{}}
  const repository=typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url;
  sections.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license||'See component source'}\nSource: ${repository||metadata.resolved||''}\nDistribution: ${metadata.resolved||''}\n\n${texts.join('\n\n')||'See the source distribution for license terms.'}`);
}
const scan=JSON.parse(await readFile('vendor/sheetscan/pin.json','utf8'));
sections.push(`SheetScan ${scan.version}\nLicense: AGPL-3.0\nCorresponding source: ${scan.source}\nLocal license and font notices: vendor/sheetscan/${scan.version}/LICENSE and licenses/\nHost packaging externalizes the embedded PDF.js worker without changing its bytes; see scripts/prepare-sheetscan.mjs in Dripping source.\n\n${await readFile('vendor/sheetscan/LICENSE','utf8')}`);
await writeFile('dist/third-party-notices.txt',sections.join('\n\n'+'='.repeat(72)+'\n\n'));
console.log('Runtime notices:',sections.length-1,'components');
