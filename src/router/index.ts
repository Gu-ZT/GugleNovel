import {createRouter, createWebHashHistory, type RouteRecordRaw} from "vue-router";
import NovelChatView from "../views/NovelChatView.vue";
import SettingsView from "../views/SettingsView.vue";
import ProviderSettingsView from "../views/settings/ProviderSettingsView.vue";
import PromptSettingsView from "../views/settings/PromptSettingsView.vue";
import GeneralSettingsView from "../views/settings/GeneralSettingsView.vue";

export type WorkspaceMode = "chat" | "settings";

const LAST_MODE_KEY = "gugle-novel-last-workspace";

const routes: RouteRecordRaw[] = [
  {path: "/", redirect: () => `/${restoreWorkspaceMode()}`},
  {path: "/chat", name: "chat", component: NovelChatView},
  {
    path: "/settings",
    name: "settings",
    component: SettingsView,
    children: [
      {path: "providers", name: "settings-providers", component: ProviderSettingsView},
      {path: "prompt", name: "settings-prompt", component: PromptSettingsView},
      {path: "general", name: "settings-general", component: GeneralSettingsView},
    ],
  },
  {path: "/:pathMatch(.*)*", redirect: "/chat"},
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.afterEach((to) => {
  const mode = typeof to.name === "string" && to.name.startsWith("settings") ? "settings" : "chat";
  localStorage.setItem(LAST_MODE_KEY, mode);
});

export function restoreWorkspaceMode(): WorkspaceMode {
  return localStorage.getItem(LAST_MODE_KEY) === "settings" ? "settings" : "chat";
}
