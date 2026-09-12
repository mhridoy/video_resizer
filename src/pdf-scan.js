import { PDFDocument } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerURL;
export async function scanCompress(input, progress) {
  const loading = getDocument({ data: input.slice(), isEvalSupported: false, useSystemFonts: true });
  let source;
  try {
    source = await loading.promise;
    const out = await PDFDocument.create();
    for (let n=1;n<=source.numPages;n++) {
      progress(`Compressing page ${n} / ${source.numPages}…`);
      const page = await source.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(100/72, 2400/Math.max(natural.width,natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext:canvas.getContext('2d'), viewport, background:'rgb(255,255,255)' }).promise;
      const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.65));
      if(!blob)throw Error('Could not render page '+n);
      const image=await out.embedJpg(await blob.arrayBuffer());
      out.addPage([natural.width,natural.height]).drawImage(image,{x:0,y:0,width:natural.width,height:natural.height});
      canvas.width=canvas.height=1;page.cleanup();
    }
    const bytes=await out.save();return bytes.length<input.length?bytes:input;
  } finally { await loading.destroy(); }
}
