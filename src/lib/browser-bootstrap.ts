// Only a brand-new non-JSPI installation may reload, before any app state or
// file input exists. Existing tabs retain the normal explicit update flow.
export async function bootstrapSharedMemory(): Promise<boolean> {
  if (
    !import.meta.env.PROD ||
    typeof (WebAssembly as typeof WebAssembly & { Suspending?: unknown }).Suspending ===
      'function' ||
    crossOriginIsolated ||
    !('serviceWorker' in navigator) ||
    navigator.serviceWorker.controller
  )
    return false;
  const guard = 'dripping.coi-bootstrap.v1';
  try {
    if (sessionStorage.getItem(guard)) return false;
  } catch {
    return false;
  }
  const root = document.getElementById('root');
  if (root) {
    root.setAttribute('role', 'status');
    root.textContent =
      localStorage.getItem('dripping.locale') === 'zh'
        ? '正在准备浏览器…'
        : 'Preparing your browser…';
  }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const done = () => {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('controllerchange', done);
          resolve();
        };
        navigator.serviceWorker.addEventListener('controllerchange', done);
        timer = setTimeout(done, 12000);
      });
    if (navigator.serviceWorker.controller === registration.active && !registration.waiting) {
      sessionStorage.setItem(guard, '1');
      location.reload();
      return true;
    }
  } catch {
    /* Ordinary practice can still mount if registration is unavailable. */
  }
  root?.removeAttribute('role');
  return false;
}
