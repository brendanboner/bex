'use client';

import * as React from 'react';
import type { ToastProps } from '@/components/ui/toast';

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;

type ToasterToast = ToastProps & {
  id: string;
  title?: string;
  description?: string;
};

let count = 0;
const genId = () => `toast-${++count}`;

type State = { toasts: ToasterToast[] };
type Action =
  | { type: 'ADD'; toast: ToasterToast }
  | { type: 'REMOVE'; toastId: string }
  | { type: 'DISMISS'; toastId?: string };

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((l) => l(memoryState));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case 'REMOVE':
      return { toasts: state.toasts.filter((t) => t.id !== action.toastId) };
    case 'DISMISS': {
      const { toastId } = action;
      if (toastId) {
        setTimeout(() => dispatch({ type: 'REMOVE', toastId }), TOAST_REMOVE_DELAY);
      } else {
        state.toasts.forEach((t) =>
          setTimeout(() => dispatch({ type: 'REMOVE', toastId: t.id }), TOAST_REMOVE_DELAY),
        );
      }
      return state;
    }
  }
}

export function toast(props: Omit<ToasterToast, 'id'>) {
  const id = genId();
  dispatch({
    type: 'ADD',
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open: boolean) => {
        if (!open) dispatch({ type: 'DISMISS', toastId: id });
      },
    },
  });
  return id;
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => { const idx = listeners.indexOf(setState); if (idx > -1) listeners.splice(idx, 1); };
  }, []);
  return {
    toasts: state.toasts,
    toast,
    dismiss: (id?: string) => dispatch({ type: 'DISMISS', ...(id !== undefined ? { toastId: id } : {}) }),
  };
}
