import { createContext, createElement, useContext, type ReactNode } from "react";

const AlwaysTooltipsContext = createContext<boolean>(false);

export function AlwaysTooltipsProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return createElement(AlwaysTooltipsContext.Provider, { value }, children);
}

/**
 * Returns true if the user has opted to always display tooltips on screen.
 * Driven by the `ui_always_show_tooltips` config key (disabled by default).
 * Defaults to false if no AlwaysTooltipsProvider is present (e.g. in isolated component tests).
 */
export function useAlwaysTooltips(): boolean {
  return useContext(AlwaysTooltipsContext);
}

