#!/usr/bin/env node
import { readFile, writeFile, copyFile, access, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2), uninstall=args.includes('--uninstall');
const root=resolve(args.find(a=>!a.startsWith('--')) || '../Marinara-Engine');
const dir=join(root,'packages/server/data/capability-packages/versions/gacha-forge/1.8.13');
const backup=join(root,'gacha-rp-presets-backup-1.8.13');
const marker='/* gacha-rp-presets-v1 */';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function exists(p){try{await access(p);return true;}catch{return false;}}
function replaceOnce(text,needle,replacement){if(text.split(needle).length!==2)throw Error(`호환되지 않는 코드: ${needle.slice(0,65)}`);return text.replace(needle,replacement);}
export function patchServer(text){
  text=replaceOnce(text,'async function _t({runtime:e,runId:t,run:n,job:r="structured",messages:a,options:f,parse:h,label:A,background:T=!1}){','async function _t({runtime:e,runId:t,run:n,job:r="structured",messages:a,options:f,parse:h,label:A,background:T=!1}){if(gfApplyRpPresets)a=await gfApplyRpPresets(t,n,r,a);');
  text=replaceOnce(text,'await t.registerPrivilegedRoutes(async s=>{','await t.registerPrivilegedRoutes(async s=>{gfApplyRpPresets=await gfSetupRpPresets(s,r,n,async id=>{const x=await be();return Ae(x.data,id)});');
  return `${marker}\nimport { setupPresets as gfSetupRpPresets } from './rp-presets-addon.mjs';\nlet gfApplyRpPresets=null;\n${text}`;
}
export function patchClient(text,addon){return replaceOnce(text,'typeof customElements<"u"&&!customElements.get(bg)&&customElements.define(bg,ec);',`${marker}\n${addon}\ntypeof customElements<"u"&&!customElements.get(bg)&&customElements.define(bg,ec);`);}
async function main(){
  const stateFile=join(backup,'state.json');
  if(uninstall){
    const state=JSON.parse(await readFile(stateFile,'utf8'));
    for(const name of ['server.mjs','client.js','manifest.json'])if(hash(await readFile(join(dir,name)))!==state.patched[name])throw Error(`${name}이 설치 후 변경됐어. 덮어쓰지 않았어. 백업에서 수동 복원해줘: ${backup}`);
    for(const name of ['server.mjs','client.js','manifest.json'])await copyFile(join(backup,name),join(dir,name));
    // Leave the unused helper: old in-flight module imports can still refer to it.
    process.stdout.write('제거 완료. 마리나라를 재시작해줘.\n');return;
  }
  let server=await readFile(join(dir,'server.mjs'),'utf8'),client=await readFile(join(dir,'client.js'),'utf8');
  if(server.includes(marker)&&client.includes(marker)){process.stdout.write('이미 설치되어 있어.\n');return;}
  if(server.includes(marker)||client.includes(marker)||await exists(stateFile))throw Error('기존/부분 설치 백업이 있어. 먼저 상태를 확인해줘.');
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
  if(manifest.id!=='gacha-forge'||manifest.version!=='1.8.13')throw Error('Gacha Forge 1.8.13만 지원해.');
  for(const path of ['db/connection.js','services/storage/prompts.storage.js','services/prompt/assembler.js'])await access(join(root,'packages/server/dist',path));
  server=patchServer(server);client=patchClient(client,await readFile(join(here,'client-addon.js'),'utf8'));
  const addon=await readFile(join(here,'server-addon.mjs'));
  const next={'server.mjs':Buffer.from(server),'client.js':Buffer.from(client),'rp-presets-addon.mjs':addon};
  for(const [name,bytes] of Object.entries(next)){
    const tmp=join(here,`.check-${name}`);await writeFile(tmp,bytes);
    const checked=spawnSync(process.execPath,['--check',tmp],{encoding:'utf8'});
    if(checked.status!==0)throw Error(checked.stderr || `${name} 구문 검사 실패`);
    const entry=manifest.files.find(f=>f.path===name);
    if(entry){entry.sha256=hash(bytes);entry.bytes=bytes.length;}
    else manifest.files.push({path:name,sha256:hash(bytes),bytes:bytes.length});
  }
  next['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  await mkdir(backup,{recursive:true});
  for(const name of ['server.mjs','client.js','manifest.json'])await copyFile(join(dir,name),join(backup,name));
  // Record before writes so any interrupted install has recoverable originals.
  await writeFile(stateFile,JSON.stringify({patched:Object.fromEntries(Object.entries(next).map(([n,b])=>[n,hash(b)]))},null,2));
  for(const [name,bytes] of Object.entries(next))await writeFile(join(dir,name),bytes);
  process.stdout.write(`설치 완료. 백업: ${backup}\n마리나라를 재시작한 뒤 브라우저를 강력 새로고침해줘.\n`);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
