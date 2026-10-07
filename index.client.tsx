import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ProfilesSurface } from "./client/profiles.tsx";

export default function contribute(client: PluginClientContext) {
  client.addSurface("profiles", ProfilesSurface);
  client.addSidebarItem({
    id: "profiles",
    title: "Provider accounts",
    icon: "Users",
    surface: "profiles",
  });
  client.addCommandCenterItem({
    id: "open-profiles",
    title: "Manage provider accounts",
    icon: "Users",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("profiles");
    },
  });
  return () => {};
}
