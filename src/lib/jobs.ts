import AudioWorker from '../workers/audio.worker?worker';

export class AudioJobs {
  private worker: Worker | undefined;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      progress?: (value: unknown) => void;
    }
  >();
  private ensure() {
    if (this.worker) return;
    this.worker = new AudioWorker();
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      if (data.progress !== undefined) {
        p.progress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
    this.worker.onerror = () => this.cancel('音频处理失败 / Audio worker failed');
  }
  run<T>(
    kind: string,
    payload: unknown,
    onProgress?: (value: unknown) => void,
    transfer: Transferable[] = [],
  ): Promise<T> {
    this.ensure();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        progress: onProgress,
      });
      try {
        this.worker!.postMessage({ id, kind, payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  cancel(message = '处理已取消 / Processing cancelled') {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) p.reject(Error(message));
    this.pending.clear();
  }
}
export const audioJobs = new AudioJobs();
