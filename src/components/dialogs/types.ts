import type { ReactNode } from 'react';
import type { Locale } from '../../lib/types';

export type DialogProps = {
  locale: Locale;
  onClose: () => void;
  onError: (text: string) => void;
  feedback?: ReactNode;
};
