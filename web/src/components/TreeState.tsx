import { createContext, useContext } from "react";

export interface TreeStateContextValue {
  expanded: Set<string>;
  toggle(path: string): void;
  reveal(path: string): void;
}

export const TreeStateContext = createContext<TreeStateContextValue | null>(null);

export function useTreeState(): TreeStateContextValue {
  const ctx = useContext(TreeStateContext);
  if (!ctx) {
    throw new Error("useTreeState must be used within a TreeStateContext.Provider");
  }
  return ctx;
}
