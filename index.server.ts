import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createProfileHandlers } from "./server/profiles.ts";
import { cancelLogin, loginStatus, startLogin, stopAllLogins, submitLoginCode } from "./server/login.ts";
import { createUsageHandler } from "./server/usage.ts";
import { usageRpc } from "./shared/usage.ts";
import { listProfilesRpc, saveProfileRpc, changeProfileRpc } from "./shared/profiles.ts";
import { cancelLoginRpc, loginStatusRpc, startLoginRpc, submitLoginCodeRpc } from "./shared/login.ts";

export default function contribute(server: PluginServerContext) {
  const handlers = createProfileHandlers();
  server.handle(listProfilesRpc, handlers.list);
  server.handle(saveProfileRpc, handlers.save);
  server.handle(changeProfileRpc, handlers.change);
  server.handle(startLoginRpc, startLogin);
  server.handle(loginStatusRpc, loginStatus);
  server.handle(submitLoginCodeRpc, submitLoginCode);
  server.handle(cancelLoginRpc, cancelLogin);
  server.handle(usageRpc, createUsageHandler());
  return stopAllLogins;
}
