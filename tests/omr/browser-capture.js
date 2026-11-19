async function encodePng(png) {
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([png], { type: 'image/png' }));
  });
  return dataUrl.split(',')[1];
}

export async function convert({ sdkUrl, modelBase, name, pdf, shared }) {
  const { createScoreConverter, SDK_VERSION, capabilities } = await import(sdkUrl);
  const OriginalWorker = window.Worker;
  const captures = [];
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => {
        if (typeof data?.xml === 'string' && ['result', 'rests-repaired'].includes(data.type)) {
          captures.push({ type: data.type, xml: data.xml });
        }
      });
    }
  };
  const converter = createScoreConverter({ modelBase });
  try {
    const bytes = Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0));
    const result = await converter.convert([new File([bytes], name, { type: 'application/pdf' })], {
      forceSharedMemory: shared,
      signal: AbortSignal.timeout(240_000),
    });
    return {
      sdkVersion: SDK_VERSION,
      recognizerVersion: result.recognizerVersion,
      capabilities: capabilities(),
      bridge: result.bridge,
      xml: result.musicxml,
      audit: result.audit,
      captures,
      rasters: await Promise.all(
        result.rasters.map(async ({ png, width, height }) => ({
          width,
          height,
          png: await encodePng(png),
        })),
      ),
    };
  } finally {
    converter.close();
    window.Worker = OriginalWorker;
  }
}

export async function readCrops(options) {
  const worker = new Worker('/__omr__/tuplet-probe.mjs', { type: 'module' });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Tuplet crop worker timed out')), 120_000);
      worker.onmessage = ({ data }) => (data.error ? reject(Error(data.error)) : resolve(data));
      worker.onerror = ({ message }) => reject(Error(message));
      worker.postMessage(options);
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
