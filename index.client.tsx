import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ProfilesSurface } from "./client/profiles.tsx";
import { styleCards } from "./client/fluid.tsx";

function ProfilesItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Users" active={currentScreen?.screenId === "profiles"} onPress={() => openScreen({ screenId: "profiles" })} />;
}

export default function contribute(client: PluginClientContext) {
  const unstyleCards = styleCards();
  client.addScreen({ id: "profiles", title: "Provider accounts", Component: ProfilesSurface });
  client.addSidebarHeaderItem({ id: "profiles", title: "Provider accounts", Component: ProfilesItem });
  client.addCommandCenterItem({
    id: "open-profiles",
    title: "Manage provider accounts",
    icon: "Users",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "profiles" });
    },
  });
  return unstyleCards;
}
