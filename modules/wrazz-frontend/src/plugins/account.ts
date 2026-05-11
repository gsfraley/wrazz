import type { Plugin } from "@/lib/plugin";
import { User, Settings, LogOut } from "@/icons";

export const accountPlugin: Plugin = {
  id: "account",
  hooks: () => [
    {
      type: "command",
      label: "Account > Edit profile",
      keywords: ["profile", "email", "account"],
      icon: User,
      defaultVisible: false,
      present: () => true,
      run: (ctx) => { ctx.openModal("profile"); },
    },
    {
      type: "command",
      label: "Account > Administration",
      keywords: ["admin", "users", "sso"],
      icon: Settings,
      defaultVisible: false,
      present: (ctx) => ctx.user.isAdmin,
      run: (ctx) => { ctx.openModal("admin"); },
    },
    {
      type: "command",
      label: "Account > Sign out",
      keywords: ["logout", "sign out"],
      icon: LogOut,
      defaultVisible: false,
      present: () => true,
      run: async (ctx) => { await ctx.logout(); },
    },
  ],
};
