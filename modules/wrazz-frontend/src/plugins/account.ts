import type { Plugin } from "@/lib/plugin";
import { User, Settings, LogOut } from "@/icons";
import { isDesktop } from "@/lib/api";

export const accountPlugin: Plugin = {
  id: "account",
  hooks: () => [
    {
      type: "command",
      label: "Account > Edit profile",
      keywords: ["profile", "email", "account"],
      icon: User,
      defaultVisible: false,
      present: () => !isDesktop(),
      run: (ctx) => { ctx.openModal("profile"); },
    },
    {
      type: "command",
      label: "Account > Administration",
      keywords: ["admin", "users", "sso"],
      icon: Settings,
      defaultVisible: false,
      present: (ctx) => !isDesktop() && ctx.user.isAdmin,
      run: (ctx) => { ctx.openModal("admin"); },
    },
    {
      type: "command",
      label: "Account > Sign out",
      keywords: ["logout", "sign out"],
      icon: LogOut,
      defaultVisible: false,
      present: () => !isDesktop(),
      run: async (ctx) => { await ctx.logout(); },
    },
  ],
};
