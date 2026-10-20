import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  SettingsForm,
  SettingsFormModel,
  SettingsValueField,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormScope,
  type SettingsFormShell,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ExpertSettings } from "../types.js";
import css from "./settings.module.css";

type GeneralField = "stateDir" | "provider";

interface GeneralState {
  shell: SettingsFormShell;
  fields: Record<GeneralField, SettingsFieldState>;
}

interface Staged {
  model: SettingsFormModel<ExpertSettings>;
  store: { getSnapshot: () => GeneralState; subscribe: (listener: () => void) => () => void };
}

/**
 * Stage and save the runtime settings shared by every expert.
 * @returns The 通用设置 tab panel body.
 */
export function GeneralTab({
  form,
  t,
}: {
  form: ConfigForm<ExpertSettings>;
  t: TranslateNS<"expert-ai">;
}): ReactNode {
  const [staged, setStaged] = useState<Staged | undefined>(undefined);
  // The model subscribes to the form, so it is created and disposed with the
  // effect rather than during render.
  useEffect(() => {
    const model = new SettingsFormModel<ExpertSettings>(form as SettingsFormScope<ExpertSettings>, [
      settingsTextField("stateDir"),
      settingsTextField("provider"),
    ]);
    const store = model.bind<GeneralState>(() => ({
      shell: model.shell(),
      fields: {
        stateDir: model.field("stateDir"),
        provider: model.field("provider"),
      },
    }));
    setStaged({ model, store });
    return () => {
      model.dispose();
    };
  }, [form]);

  return (
    <div className={css.panel}>
      <p className={css.muted}>{t("generalHint")}</p>
      {staged === undefined ? null : <GeneralFields model={staged.model} store={staged.store} t={t} />}
    </div>
  );
}

function GeneralFields({ model, store, t }: Staged & { t: TranslateNS<"expert-ai"> }): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const actions = model.actions();
  const disabled = !state.shell.writable || state.shell.saving;

  const field = (
    name: GeneralField,
    hint: "stateDirHint" | "providerHint",
    extra: { placeholder?: string },
  ): ReactNode => (
    <SettingsValueField
      id={`expert-ai-${name}`}
      label={t(name)}
      hint={t(hint)}
      text={state.fields[name].text}
      overridden={state.fields[name].overridden}
      invalid={state.fields[name].invalid}
      overriddenLabel={t("overridden")}
      resetLabel={t("reset")}
      invalidLabel={t("invalidValue")}
      disabled={disabled}
      onEdit={(text) => {
        actions.edit(name, text);
      }}
      onReset={() => {
        actions.resetField(name);
      }}
      {...extra}
    />
  );

  return (
    <SettingsForm
      labels={{
        unavailable: t("unavailable"),
        readOnly: t("readOnly"),
        saveFailed: t("saveFailed"),
        save: t("save"),
        saving: t("saving"),
      }}
      state={state.shell}
      onSave={actions.save}
      onDiscard={actions.discard}
    >
      {field("stateDir", "stateDirHint", { placeholder: t("stateDirPlaceholder") })}
      {field("provider", "providerHint", { placeholder: "spawn" })}
    </SettingsForm>
  );
}
