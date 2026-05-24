"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

export function usePopover() {
  const context = useContext(PopoverContext);

  if (!context) {
    throw new Error("Popover components must be used inside Popover.");
  }

  return context;
}

export function Popover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, []);

  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <div className="popover" ref={rootRef}>
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

export function PopoverTrigger({ children }: { children: ReactNode }) {
  const { open, setOpen } = usePopover();

  return (
    <button
      type="button"
      className="date-picker-trigger"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {children}
    </button>
  );
}

export function PopoverContent({ children }: { children: ReactNode }) {
  const { open } = usePopover();

  if (!open) {
    return null;
  }

  return <div className="popover-content">{children}</div>;
}
