import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
function fixture(portable=false, fail=false) {
  const menus=[];const autoUpdater=new EventEmitter();let checks=0,interval;
  autoUpdater.checkForUpdates=async()=>{checks++;if(fail)throw Error('Offline');autoUpdater.emit('update-not-available');};
  const module={exports:{}};
  vm.runInNewContext(readFileSync(new URL('../electron/updates.cjs',import.meta.url),'utf8'),{module,require:()=>({Menu:{buildFromTemplate:x=>x,setApplicationMenu:x=>menus.push(x)}}),process:{platform:'win32'},setInterval});
  const controls=module.exports.setupUpdates({app:{isPackaged:true,getVersion:()=> '1.2.0'},autoUpdater,portable,setTimer:(fn,ms)=>{interval={fn,ms};return {unref(){}};}});
  return {autoUpdater,menus,controls,get checks(){return checks},get interval(){return interval}};
}
test('installed app checks, downloads stable updates and installs only on exit',async()=>{
 const f=fixture();await new Promise(r=>setImmediate(r));assert.equal(f.checks,1);assert.equal(f.autoUpdater.autoDownload,true);assert.equal(f.autoUpdater.autoInstallOnAppQuit,true);assert.equal(f.autoUpdater.allowDowngrade,false);assert.equal(f.interval.ms,14400000);
 f.autoUpdater.emit('update-downloaded',{version:'1.2.101'});await f.controls.check();assert.equal(f.checks,1);assert.match(f.menus.at(-1)[2].submenu[0].label,/ready.*exit/);
});
test('portable builds never check or schedule installer updates',async()=>{
 const f=fixture(true);await f.controls.check();assert.equal(f.checks,0);assert.equal(f.interval,undefined);
});
test('offline checks remain retryable',async()=>{
 const f=fixture(false,true);await new Promise(r=>setImmediate(r));await f.controls.check();assert.equal(f.checks,2);assert.match(f.menus.at(-1)[2].submenu[0].label,/online/);
});
