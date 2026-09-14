import {computed, reactive} from "vue";
import {useRouter} from "vue-router";
import {useProviderSettings} from "../settings/provider";
import {usePromptSettings} from "../settings/prompt";
import {useGenerationSettings} from "../settings/generation";
import {useNovelWorkspace} from "../workspace/novel";

export type WorkspaceMode = "chat" | "settings";

export function useAppController() {
  const router = useRouter();
  const provider = useProviderSettings();
  const prompt = usePromptSettings();
  const generation = useGenerationSettings();
  const novel = useNovelWorkspace({provider, prompt, generation});

  provider.initialize();
  if (novel.conversations.value.length === 0) {
    novel.createNewConversation();
  }

  const appMode = computed<WorkspaceMode>(() =>
      router.currentRoute.value.name === "settings" ||
      String(router.currentRoute.value.name ?? "").startsWith("settings")
          ? "settings"
          : "chat"
  );

  function setAppMode(mode: WorkspaceMode) {
    void router.push(mode === "settings" ? {name: "settings"} : {name: "chat"});
  }

  const viewModel = reactive({
    ...provider,
    ...prompt,
    ...generation,
    ...novel,
  });

  return {appMode, setAppMode, viewModel};
}

export type AppViewModel = ReturnType<typeof useAppController>["viewModel"];
