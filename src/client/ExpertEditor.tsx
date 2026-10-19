import { useRef, useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, IconFolderOpenOutlineRegular, Input, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { DigitalLifeCategory, DigitalLifeRecord, ExpertIdentitySourceKind } from "../types.js";
import { avatarDataUrl } from "../avatar.js";
import { DIGITAL_LIFE_CATEGORIES, EXPERT_SOURCE_KINDS } from "../constants.js";
import { applyAgentMarkdown } from "./agent-file.js";
import { avatarFromFile } from "./avatar-file.js";
import { MenuSelect, errorText } from "./controls.js";
import { categoryLabel, type DigitalLifeKey } from "./locales.js";
import { recordProblem } from "./records.js";
import css from "./settings.module.css";

const SOURCE_COPY = {
  public: { label: "sourcePublic", hint: "sourcePublicHint" },
  organization: { label: "sourceOrganization", hint: "sourceOrganizationHint" },
  authorized: { label: "sourceAuthorized", hint: "sourceAuthorizedHint" },
} as const satisfies Record<ExpertIdentitySourceKind, { label: DigitalLifeKey; hint: DigitalLifeKey }>;

/**
 * Add or edit one digital-life record in a dialog.
 * @returns The editor dialog.
 */
export function ExpertEditor({
  initial,
  existing,
  importedFile,
  ids,
  t,
  onSave,
  onCancel,
}: {
  initial: DigitalLifeRecord;
  /** Whether the record is already saved; its id and identity source are then fixed. */
  existing: boolean;
  /** Name of the Agent file `initial` was imported from, if any. */
  importedFile?: string | undefined;
  ids: ReadonlySet<string>;
  t: TranslateNS<"digital-life">;
  /** Persist the draft; resolves to an error message, or undefined once saved. */
  onSave: (draft: DigitalLifeRecord) => Promise<string | undefined>;
  onCancel: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [boundFile, setBoundFile] = useState<string | undefined>(importedFile);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [avatarError, setAvatarError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const update = <K extends keyof DigitalLifeRecord>(key: K, value: DigitalLifeRecord[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (invalid.has(String(key))) {
      setInvalid((current) => {
        const next = new Set(current);
        next.delete(String(key));
        return next;
      });
    }
  };
  const bindFile = async (file: File): Promise<void> => {
    try {
      const next = applyAgentMarkdown(await file.text(), file.name, draft);
      if (next === undefined) throw new Error(t("identityError"));
      setDraft(next);
      setBoundFile(file.name);
      setFileError(undefined);
    } catch (reason) {
      setFileError(errorText(reason));
    }
  };
  const pickAvatar = async (file: File): Promise<void> => {
    const result = await avatarFromFile(file);
    if ("avatar" in result) {
      update("avatar", result.avatar);
      setAvatarError(undefined);
    } else {
      setAvatarError(t(result.problem === "tooLarge" ? "avatarTooLarge" : "avatarUnreadable"));
    }
  };
  const save = (): void => {
    const problem = recordProblem(draft, ids, existing ? initial.id : undefined);
    if (problem !== undefined) {
      setInvalid(problem.fields);
      setError(t(problem.reason));
      return;
    }
    setSaving(true);
    setError(undefined);
    void onSave(draft)
      .then((message) => {
        if (message !== undefined) setError(message);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const managedBinding = `${draft.id}/agents/${draft.id}.md`;
  const externalBinding = draft.agent !== undefined && draft.agent !== managedBinding;
  const controlClass = (field: string): string => `${css.control} ${invalid.has(field) ? css.invalid : ""}`;
  const sourceKind: ExpertIdentitySourceKind = draft.source?.kind ?? "public";
  const fileHint =
    fileError ??
    (externalBinding
      ? t("externalHint")
      : existing
        ? t("managedExistingHint")
        : boundFile === undefined
          ? t("managedNewHint")
          : t("importedHint", {
              file: boundFile,
              path: `${draft.id || "{id}"}/agents/${draft.id || "{id}"}.md`,
            }));

  return (
    <Modal
      open
      onClose={onCancel}
      title={existing ? `${t("edit")} ${draft.name || t("defaultLife")}` : t("dialogAdd")}
      closeLabel={t("close")}
      className={css.dialog ?? ""}
      contentClassName={css.dialogContent ?? ""}
      footer={
        <>
          {error === undefined ? null : (
            <span className={`${css.error} ${css.grow}`} role="alert">
              {error}
            </span>
          )}
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className={css.form}>
        <label className={css.field}>
          <span className={css.label}>{t("id")}</span>
          <Input
            className={controlClass("id")}
            value={draft.id}
            onChange={(event) => {
              update("id", event.target.value);
            }}
            placeholder="user-xx"
            disabled={existing}
            readOnly={existing}
            {...(existing ? {} : { "data-modal-autofocus": "" })}
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t("name")}</span>
          <Input
            className={controlClass("name")}
            value={draft.name}
            onChange={(event) => {
              update("name", event.target.value);
            }}
            placeholder={t("namePlaceholder")}
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t("tags")}</span>
          <Input
            className={controlClass("tags")}
            value={draft.tags.join(", ")}
            onChange={(event) => {
              update(
                "tags",
                event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              );
            }}
            placeholder={t("tagsPlaceholder")}
          />
        </label>
        <div className={css.field}>
          <span className={css.label}>{t("category")}</span>
          <MenuSelect
            value={draft.category}
            placeholder={t("category")}
            options={DIGITAL_LIFE_CATEGORIES.map((category) => ({
              value: category,
              label: categoryLabel({ category }, t),
            }))}
            onChange={(value) => {
              update("category", value as DigitalLifeCategory);
            }}
          />
        </div>
        {draft.category === "custom" ? (
          <label className={`${css.field} ${css.full}`}>
            <span className={css.label}>{t("customCategory")}</span>
            <Input
              className={controlClass("customCategory")}
              value={draft.customCategory ?? ""}
              onChange={(event) => {
                update("customCategory", event.target.value);
              }}
              placeholder={t("customCategoryPlaceholder")}
            />
          </label>
        ) : null}
        <div className={css.field}>
          <label className={css.label} htmlFor="digital-life-title">
            {t("titleLabel")}
          </label>
          <Input
            id="digital-life-title"
            className={controlClass("title")}
            value={draft.title ?? ""}
            onChange={(event) => {
              update("title", event.target.value);
            }}
            placeholder={t("titlePlaceholder")}
          />
          <span className={css.hint}>{t("titleHint")}</span>
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="digital-life-source">
            {t("sourceKind")}
          </label>
          <MenuSelect
            id="digital-life-source"
            value={sourceKind}
            placeholder={t("sourceKind")}
            options={EXPERT_SOURCE_KINDS.map((kind) => ({ value: kind, label: t(SOURCE_COPY[kind].label) }))}
            onChange={(value) => {
              update("source", { ...draft.source, kind: value as ExpertIdentitySourceKind });
            }}
          />
          <span className={css.hint}>{t(SOURCE_COPY[sourceKind].hint)}</span>
        </div>
        <div className={`${css.field} ${css.full}`}>
          <label className={css.label} htmlFor="digital-life-source-note">
            {t("sourceNote")}
          </label>
          <Input
            id="digital-life-source-note"
            className={controlClass("source")}
            value={draft.source?.note ?? ""}
            onChange={(event) => {
              update("source", { kind: sourceKind, note: event.target.value });
            }}
            placeholder={t("sourceNotePlaceholder")}
          />
        </div>
        <div className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("avatar")}</span>
          <div className={css.avatarRow}>
            {draft.avatar === undefined ? null : (
              <img className={css.avatarPreview} src={avatarDataUrl(draft.avatar)} alt="" />
            )}
            <Button variant="outline" onClick={() => avatarInput.current?.click()}>
              {t("avatarChoose")}
            </Button>
            {draft.avatar === undefined ? null : (
              <Button
                variant="outline"
                onClick={() => {
                  update("avatar", undefined);
                  setAvatarError(undefined);
                }}
              >
                {t("avatarRemove")}
              </Button>
            )}
            <input
              ref={avatarInput}
              className={css.hiddenFile}
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void pickAvatar(file);
                event.target.value = "";
              }}
            />
          </div>
          <span className={`${css.hint} ${avatarError === undefined ? "" : css.fieldError}`}>
            {avatarError ?? t("avatarHint")}
          </span>
        </div>
        <div className={`${css.field} ${css.full}`}>
          <label className={css.label} htmlFor="digital-life-agent">
            {t("agent")}
          </label>
          <div className={css.fileRow}>
            <Input
              id="digital-life-agent"
              className={`${css.control} ${css.grow}`}
              value={draft.agent ?? (existing ? `agents/${draft.id}.md` : "")}
              onChange={(event) => {
                const value = event.target.value.trim();
                update("agent", value === "" ? undefined : value);
                setBoundFile(undefined);
              }}
              placeholder={t("agentPlaceholder")}
              disabled={existing}
              readOnly={existing}
            />
            {existing ? null : (
              <Button variant="outline" icon={<IconFolderOpenOutlineRegular size={16} />} onClick={() => fileInput.current?.click()}>
                {t("importFile")}
              </Button>
            )}
            <input
              ref={fileInput}
              className={css.hiddenFile}
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void bindFile(file);
                event.target.value = "";
              }}
            />
          </div>
          <span className={`${css.hint} ${fileError === undefined ? "" : css.fieldError}`}>{fileHint}</span>
        </div>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("description")}</span>
          <Input
            className={controlClass("description")}
            value={draft.description}
            onChange={(event) => {
              update("description", event.target.value);
            }}
            placeholder={t("descriptionPlaceholder")}
          />
        </label>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>
            {t("persona")} {externalBinding ? t("personaExternal") : existing ? t("personaManaged") : ""}
          </span>
          <textarea
            className={`${css.textarea} ${invalid.has("persona") ? css.invalid : ""}`}
            rows={8}
            value={draft.persona}
            readOnly={externalBinding}
            onChange={(event) => {
              update("persona", event.target.value);
            }}
          />
        </label>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("tools")}</span>
          <Input
            className={css.control ?? ""}
            value={draft.toolFilter?.join(", ") ?? ""}
            onChange={(event) => {
              const values = event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
              update("toolFilter", values.length === 0 ? undefined : values);
            }}
          />
        </label>
      </div>
    </Modal>
  );
}
