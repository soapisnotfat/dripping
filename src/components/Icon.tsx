export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    play: 'm8 5 11 7-11 7V5Z',
    pause: 'M8 5v14M16 5v14',
    stop: 'M6 6h12v12H6z',
    back: 'M6 5v14m13-14L8 12l11 7V5Z',
    loop: 'M5 7h12a3 3 0 0 1 3 3v2M5 7l3-3M5 7l3 3M19 17H7a3 3 0 0 1-3-3v-2m15 5-3 3m3-3-3-3',
    export: 'M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6',
    folder: 'M3 7V4h7l2 3h9v13H3V7Z',
    undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 6 6v3',
    redo: 'm15 5 5 5-5 5m5-5H10a6 6 0 0 0-6 6v3',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    mic: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V4ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8',
    align: 'M5 3v18M19 3v18M3 7h8m2 10h8M9 10l3 2-3 2m6-4-3 2 3 2',
    expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    chevron: 'm8 5 7 7-7 7',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
    close: 'm6 6 12 12M6 18 18 6',
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.settings} />
    </svg>
  );
}
