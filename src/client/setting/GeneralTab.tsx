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
import type { ExpertSettings } from "../../types.js";
import css from "./settings.module.css";

interface GeneralState {
  shell: SettingsFormShell;
  field: SettingsFieldState;
}

interface Staged {
  model: SettingsFormModel<ExpertSettings>;
  store: { getSnapshot: () => GeneralState; subscribe: (listener: () => void) => () => void };
}

/**
 * Stage and save the plugin data directory shared by every expert.
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
    ]);
    const store = model.bind<GeneralState>(() => ({
      shell: model.shell(),
      field: model.field("stateDir"),
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
      <SettingsValueField
        id="expert-ai-stateDir"
        label={t("stateDir")}
        hint={t("stateDirHint")}
        text={state.field.text}
        overridden={state.field.overridden}
        invalid={state.field.invalid}
        overriddenLabel={t("overridden")}
        resetLabel={t("reset")}
        invalidLabel={t("invalidValue")}
        disabled={disabled}
        onEdit={(text) => {
          actions.edit("stateDir", text);
        }}
        onReset={() => {
          actions.resetField("stateDir");
        }}
        placeholder={t("stateDirPlaceholder")}
      />
    </SettingsForm>
  );
}
