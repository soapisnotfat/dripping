// Exercise the exact recognizer files carried by the current SDK using its own
// browser Python runtime. The crop reader needs neither the score nor the ONNX models.
self.onmessage = async ({ data }) => {
  try {
    const indexURL = new URL(data.runtimeUrl, location.origin).href;
    const { loadPyodide } = await import(new URL('pyodide.mjs', indexURL).href);
    const python = await loadPyodide({ indexURL });
    await python.loadPackage(['numpy', 'opencv-python'], { messageCallback() {} });
    python.FS.mkdirTree('/probe');
    for (const [name, source] of Object.entries(data.modules)) {
      python.FS.writeFile(`/probe/${name}`, source);
    }
    const observations = [];
    python.runPython(`
import json, sys, cv2
sys.path.insert(0, '/probe')
from printed_tuplets import read_tuplet_marks

def read_crop(boxes):
    image = cv2.imread('/probe/source.png', cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError('Invalid crop PNG')
    return json.dumps(read_tuplet_marks(image, json.loads(boxes)))
`);
    const read = python.globals.get('read_crop');
    try {
      for (const item of data.crops) {
        python.FS.writeFile(
          '/probe/source.png',
          Uint8Array.from(atob(item.png), (c) => c.charCodeAt(0)),
        );
        observations.push({
          id: item.id,
          marks: JSON.parse(read(JSON.stringify(item.staffBoxes))),
        });
      }
    } finally {
      read.destroy();
    }
    self.postMessage({ observations });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
