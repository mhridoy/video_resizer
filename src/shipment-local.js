let worker;
export function stopLocalVision() {worker?.terminate();worker=undefined;}
function classify(file, signal, status) {
  signal.throwIfAborted();
  worker ||= new Worker(new URL('./shipment-local.worker.js', import.meta.url), {type:'module'});
  const active = worker, image = URL.createObjectURL(file);
  return new Promise((resolve,reject)=>{
    let timer;
    const resetTimer=()=>{clearTimeout(timer);timer=setTimeout(()=>{clean();stopLocalVision();reject(Error('Local ML stopped responding. Check the connection and retry, or choose OCR only.'));},180_000);};
    const clean=()=>{clearTimeout(timer);URL.revokeObjectURL(image);signal.removeEventListener('abort',abort);active.onmessage=null;active.onerror=null;};
    const abort=()=>{clean();stopLocalVision();reject(new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    active.onmessage=({data})=>{
      if(data.progress){resetTimer();status(data.progress);return;}
      clean();
      if(data.error){stopLocalVision();reject(Error(`Local ML model could not load or run: ${data.error}. Check internet for the first model download, or use OCR only.`));}
      else resolve(data.result);
    };
    active.onerror=event=>{clean();stopLocalVision();reject(Error(`Local ML worker failed: ${event.message}`));};
    resetTimer(); active.postMessage({image});
  });
}
export async function analyzeLocalShipment(items,{signal,status,onResult}) {
  try {
  for(const [index,item] of items.entries()) {
    signal.throwIfAborted();
    status(`Local ML: ${index+1}/${items.length} · ${item.file.name}`);
    const document = ['weight','invoices','vat','packing','shipping','documents'].includes(item.category);
    let found={category:item.category,stage:'',confidence:1,reason:'Read locally with OCR and QR detection.'};
    if(item.kind==='image' && !document && item.category!=='seals') found=await classify(item.mlPreview || item.file,signal,status);
    signal.throwIfAborted();
    onResult({id:String(item.id),...found,quality:0,duplicateOf:null,documentType:item.documentType || 'SHIPPING_DOC',
      invoiceNumber:item.invoiceNumber || '',hasQrCode:!!item.hasQrCode,
      container:item.evidence.containers.length===1?item.evidence.containers[0]:null,
      seal:item.evidence.seals.length===1?item.evidence.seals[0].id:'',
    });
  }
  } finally { stopLocalVision(); }
}
