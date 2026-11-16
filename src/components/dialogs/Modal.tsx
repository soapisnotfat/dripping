import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  feedback,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  feedback?: ReactNode;
  closeDisabled?: boolean;
}) {
  const closeRef = useRef(onClose),
    dialog = useRef<HTMLElement>(null),
    previous = useRef(document.activeElement as HTMLElement);
  closeRef.current = onClose;
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement))
      (
        dialog.current?.querySelector<HTMLElement>('[data-dialog-autofocus]') ||
        dialog.current?.querySelector<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
        )
      )?.focus();
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', fn);
    return () => {
      document.removeEventListener('keydown', fn);
      (previous.current?.isConnected
        ? previous.current
        : document.querySelector<HTMLElement>('[data-modal-focus-fallback]')
      )?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const els = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button,input,select,a[href],textarea,summary,[tabindex]',
            ),
          )
            .filter((n) => {
              for (
                let parent = n.parentElement;
                parent && parent !== e.currentTarget;
                parent = parent.parentElement
              )
                if (
                  parent.tagName === 'DETAILS' &&
                  !parent.hasAttribute('open') &&
                  !parent.querySelector(':scope > summary')?.contains(n)
                )
                  return false;
              return (
                n.tabIndex >= 0 &&
                !n.matches(':disabled') &&
                !n.closest('[hidden],[inert]') &&
                n.getClientRects().length > 0 &&
                getComputedStyle(n).visibility === 'visible'
              );
            })
            .sort(
              (a, b) =>
                (a.tabIndex > 0 ? a.tabIndex : Number.MAX_SAFE_INTEGER) -
                (b.tabIndex > 0 ? b.tabIndex : Number.MAX_SAFE_INTEGER),
            );
          const first = els[0],
            last = els.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close / 关闭"
            disabled={closeDisabled}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {feedback}
        {children}
      </section>
    </div>
  );
}
