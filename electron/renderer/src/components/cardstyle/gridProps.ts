import type { ComponentProps } from "react";
import type Card from "../Card";

/**
 * What SectionList hands a card through `cloneElement` (open / onToggle /
 * dragHandle / className…). A remade card must pass it on to its <Card>, or
 * it can no longer be collapsed or moved in the grid.
 */
export type GridProps = Omit<ComponentProps<typeof Card>, "title" | "children">;
