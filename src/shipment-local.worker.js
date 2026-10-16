import { pipeline, env } from '@huggingface/transformers';
import { VISION_LABELS, interpretLocalVision } from '../shared/local-vision.mjs';
let classifier, lastProgress;
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = new URL('../ml/', self.location.href).href;
self.onmessage = async ({data}) => {
  try {
    classifier ||= pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
      device:'wasm', dtype:'q8', revision:'d15189d7028b43f1d3e65039190477f6af591c2a', progress_callback: progress => {
        if (progress.status === 'progress') {
          const message = `Downloading local ML model: ${progress.file} ${Math.round(progress.progress || 0)}%`;
          if(message !== lastProgress) {lastProgress=message;self.postMessage({progress:message});}
        }
      },
    }).catch(error=>{classifier=undefined;throw error;});
    const model = await classifier;
    const scores = await model(data.image, VISION_LABELS.map(([label])=>label));
    self.postMessage({result:interpretLocalVision(scores)});
  } catch(error) {self.postMessage({error:error.message});}
};
