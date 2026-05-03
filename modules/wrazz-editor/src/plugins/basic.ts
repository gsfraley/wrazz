import type { ContentPlugin } from "./types";
import { esc } from "../utils";

export const bold: ContentPlugin = {
  name: "bold",
  interaction: { kind: "inline", pattern: /\*\*[^*\n]+\*\*/ },
  render(m) {
    return (
      `<strong><span class="we-mark">**</span>` +
      esc(m[0].slice(2, -2)) +
      `<span class="we-mark">**</span></strong>`
    );
  },
};

export const italic: ContentPlugin = {
  name: "italic",
  interaction: { kind: "inline", pattern: /\*[^*\n]+\*/ },
  render(m) {
    return (
      `<em><span class="we-mark">*</span>` +
      esc(m[0].slice(1, -1)) +
      `<span class="we-mark">*</span></em>`
    );
  },
};
