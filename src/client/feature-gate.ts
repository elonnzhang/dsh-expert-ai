import type { ConfigFormSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";
import { enabledFeatures } from "../features.js";
import type { ExpertFeature, ExpertSettings } from "../types.js";

interface FeatureForm {
  getSnapshot(): ConfigFormSnapshot<ExpertSettings>;
  subscribe(listener: () => void): () => void;
}

/** Run `mount` while the form says `feature` is on; nothing is mounted until the setting is known. */
export function mountWhile(form: FeatureForm, feature: ExpertFeature, mount: () => () => void): () => void {
  let unmount: (() => void) | undefined;
  const sync = (): void => {
    const snapshot = form.getSnapshot();
    if (snapshot.status === "loading") return;
    const on =
      snapshot.status === "ready" &&
      snapshot.value !== undefined &&
      enabledFeatures(snapshot.value.features).has(feature);
    if (on && unmount === undefined) unmount = mount();
    else if (!on && unmount !== undefined) {
      unmount();
      unmount = undefined;
    }
  };
  const unsubscribe = form.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    unmount?.();
    unmount = undefined;
  };
}
