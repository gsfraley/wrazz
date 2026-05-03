export type { CaretPos, Interaction, PluginContext, ContentPlugin } from "./types";

import type { ContentPlugin } from "./types";
import { bold, italic } from "./basic";
import { heading } from "./headings";

export { bold, italic, heading };

/** All plugins in priority order. Bold before italic so ** beats *. */
export const PLUGINS: ContentPlugin[] = [bold, italic, heading];

export const INLINE_PLUGINS = PLUGINS.filter(
  (p) => p.interaction.kind === "inline"
);

export const LINE_PREFIX_PLUGINS = PLUGINS.filter(
  (p) => p.interaction.kind === "line-prefix"
);
