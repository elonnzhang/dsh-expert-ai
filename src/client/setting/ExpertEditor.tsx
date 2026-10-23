import { useRef, useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  IconFolderOpenOutlineRegular,
  Input,
  Modal,
  Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ExpertCategory, ExpertIdentitySourceKind, ExpertOrigin, ExpertRecord } from "../../types.js";
import { originOf } from "../../record-model.js";
import { avatarDataUrl } from "../../avatar.js";
import { EXPERT_AI_CATEGORIES, EXPERT_SOURCE_KINDS } from "../../constants.js";
import { applyAgentMarkdown } from "./agent-file.js";
import { avatarFromFile } from "./avatar-file.js";
import { MenuSelect, errorText } from "./controls.js";
import { categoryLabel, type ExpertKey } from "../shared/locales.js";
import { copyAsManaged, normalizeExpertRecord, recordProblem } from "./records.js";
import css from "./settings.module.css";

const SOURCE_COPY = {
  public: { label: "sourcePublic", hint: "sourcePublicHint" },
  organization: { label: "sourceOrganization", hint: "sourceOrganizationHint" },
  authorized: { label: "sourceAuthorized", hint: "sourceAuthorizedHint" },
} as const satisfies Record<ExpertIdentitySourceKind, { label: ExpertKey; hint: ExpertKey }>;

/**
 * Add or edit one expert record in a dialog.
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
  initial: ExpertRecord;
  /** Whether the record is already saved; its id and identity source are then fixed. */
  existing: boolean;
  /** Name of the Agent file `initial` was imported from, if any. */
  importedFile?: string | undefined;
  ids: ReadonlySet<string>;
  t: TranslateNS<"expert-ai">;
  /** Persist the draft; resolves to an error message, or undefined once saved. */
  onSave: (draft: ExpertRecord) => Promise<string | undefined>;
  onCancel: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [boundFile, setBoundFile] = useState<string | undefined>(importedFile);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [avatarError, setAvatarError] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const initialOrigin = originOf(initial);
  const copyableOrigin: ExpertOrigin | undefined =
    initialOrigin.kind === "bundled" || initialOrigin.kind === "package" ? initialOrigin : undefined;
  const origin = existing && copyableOrigin !== undefined ? copyableOrigin : originOf(draft);
  const latestPick = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const update = <K extends keyof ExpertRecord>(key: K, value: ExpertRecord[K]): void => {
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
      const source = existing ? { ...draft, id: initial.id } : { ...draft, origin: { kind: "managed" as const } };
      const next = applyAgentMarkdown(await file.text(), file.name, source);
      if (next === undefined) throw new Error(t("identityError"));
      setDraft(next);
      setBoundFile(file.name);
      setFileError(undefined);
    } catch (reason) {
      setFileError(errorText(reason));
    }
  };
  const pickAvatar = async (file: File): Promise<void> => {
    const pick = ++latestPick.current;
    setPicking(true);
    const result = await avatarFromFile(file);
    if (pick !== latestPick.current) return;
    setPicking(false);
    if ("avatar" in result) {
      update("avatar", result.avatar);
      setAvatarError(undefined);
    } else {
      setAvatarError(t(result.problem === "tooLarge" ? "avatarTooLarge" : "avatarUnreadable"));
    }
  };
  const removeAvatar = (): void => {
    latestPick.current += 1;
    setPicking(false);
    update("avatar", undefined);
    setAvatarError(undefined);
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

  const controlClass = (field: string): string => `${css.control} ${invalid.has(field) ? css.invalid : ""}`;
  const sourceKind: ExpertIdentitySourceKind = draft.source?.kind ?? "public";
  const managed = origin.kind === "managed";
  const canCopy = existing && draft.origin?.kind === "managed" && copyableOrigin !== undefined;
  const editableFile = !existing && origin.kind === "file";
  const canImportFile = !existing && origin.kind === "managed";
  const originTitle =
    origin.kind === "managed"
      ? t("originManaged")
      : origin.kind === "file"
        ? t("originFile")
        : origin.kind === "bundled"
          ? t("originBundled")
          : t("originPackage");
  const originName =
    origin.kind === "bundled"
      ? origin.path
      : origin.kind === "package"
        ? `${origin.slug}@${origin.ref || origin.revision.slice(0, 7)}`
        : "";
  const fileHint =
    fileError ??
    (origin.kind === "file"
      ? t("externalHint")
      : origin.kind === "bundled"
        ? t("originBundledHint", { path: origin.path })
        : origin.kind === "package"
          ? t("originPackageHint", { package: originName })
          : existing
            ? t("managedExistingHint")
            : boundFile === undefined
              ? t("managedNewHint")
              : t("importedHint", {
                  file: boundFile,
                  path: `${draft.id || "{id}"}/agents/${draft.id || "{id}"}.md`,
                }));
  const convertNewOrigin = (kind: "managed" | "file"): void => {
    setDraft((current) => ({
      ...current,
      ...(kind === "managed"
        ? { origin: { kind } }
        : { origin: { kind, path: current.origin?.kind === "file" ? current.origin.path : "" } }),
    }));
  };
  const pathValue = origin.kind === "file" ? origin.path : "";
  const updateOriginPath = (path: string): void => {
    setDraft((current) => ({ ...current, origin: { kind: "file", path } }));
    setBoundFile(undefined);
  };
  const copyManaged = (): void => {
    setDraft(copyAsManaged(draft));
    setBoundFile(undefined);
    setFileError(undefined);
    setInvalid((current) => {
      const next = new Set(current);
      next.delete("persona");
      next.delete("origin");
      return next;
    });
  };

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
            <span className={`${css.error} ${css.footerError}`} role="alert">
              {error}
            </span>
          )}
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || picking}>
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
            options={EXPERT_AI_CATEGORIES.map((category) => ({
              value: category,
              label: categoryLabel({ category }, t),
            }))}
            onChange={(value) => {
              update("category", value as ExpertCategory);
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
          <label className={css.label} htmlFor="expert-ai-title">
            {t("titleLabel")}
          </label>
          <Input
            id="expert-ai-title"
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
          <label className={css.label} htmlFor="expert-ai-source">
            {t("sourceKind")}
          </label>
          <MenuSelect
            id="expert-ai-source"
            value={sourceKind}
            placeholder={t("sourceKind")}
            options={EXPERT_SOURCE_KINDS.map((kind) => ({ value: kind, label: t(SOURCE_COPY[kind].label) }))}
            onChange={(value) => {
              setDraft((current) => ({
                ...current,
                source: { ...current.source, kind: value as ExpertIdentitySourceKind },
              }));
            }}
          />
          <span className={css.hint}>{t(SOURCE_COPY[sourceKind].hint)}</span>
        </div>
        <div className={`${css.field} ${css.full}`}>
          <label className={css.label} htmlFor="expert-ai-source-note">
            {t("sourceNote")}
          </label>
          <Input
            id="expert-ai-source-note"
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
            {draft.avatar == null ? null : (
              <img className={css.avatarPreview} src={avatarDataUrl(draft.avatar)} alt="" />
            )}
            <Button variant="outline" onClick={() => avatarInput.current?.click()}>
              {t("avatarChoose")}
            </Button>
            {draft.avatar == null ? null : (
              <Button variant="outline" onClick={removeAvatar}>
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
          <label className={css.label} htmlFor="expert-ai-agent">
            {existing ? t("origin") : t("identityOrigin")}
          </label>
          {existing ? (
            <div className={css.originRow}>
              <Tag tone="info">{originTitle}</Tag>
              {origin.kind === "file" ? <code className={css.code}>{origin.path}</code> : null}
              {origin.kind === "bundled" ? <code className={css.code}>{origin.path}</code> : null}
              {origin.kind === "package" ? <code className={css.code}>{originName}</code> : null}
              {canCopy ? (
                <Button variant="outline" onClick={copyManaged}>
                  {t("copyAsManaged")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className={css.originChoices}>
              <Button
                variant={origin.kind === "managed" ? "primary" : "outline"}
                aria-pressed={origin.kind === "managed"}
                onClick={() => {
                  convertNewOrigin("managed");
                }}
              >
                {t("originManaged")}
              </Button>
              <Button
                variant={origin.kind === "file" ? "primary" : "outline"}
                aria-pressed={origin.kind === "file"}
                onClick={() => {
                  convertNewOrigin("file");
                }}
              >
                {t("originHostFile")}
              </Button>
            </div>
          )}
          {editableFile ? (
            <div className={css.fileRow}>
              <Input
                id="expert-ai-agent"
                className={`${css.control} ${css.grow} ${invalid.has("origin") ? css.invalid : ""}`}
                value={pathValue}
                onChange={(event) => {
                  updateOriginPath(event.target.value);
                }}
                placeholder={t("agentPlaceholder")}
              />
            </div>
          ) : null}
          {canImportFile ? (
            <div className={css.fileRow}>
              <Button variant="outline" icon={<IconFolderOpenOutlineRegular size={16} />} onClick={() => fileInput.current?.click()}>
                {t("importFile")}
              </Button>
            </div>
          ) : null}
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
          <span className={`${css.hint} ${fileError === undefined ? "" : css.fieldError}`}>{fileHint}</span>
          {canCopy ? <span className={css.hint}>{t("copyAsManagedHint")}</span> : null}
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
        <div className={css.field}>
          <label className={css.label} htmlFor="expert-ai-model-provider">
            {t("consultProvider")}
          </label>
          <Input
            id="expert-ai-model-provider"
            className={controlClass("model")}
            value={draft.model?.provider ?? ""}
            onChange={(event) => {
              update("model", {
                provider: event.target.value,
                ...(draft.model?.model === undefined ? {} : { model: draft.model.model }),
              });
            }}
            placeholder={t("consultProviderPlaceholder")}
          />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="expert-ai-model-name">
            {t("consultModel")}
          </label>
          <Input
            id="expert-ai-model-name"
            className={controlClass("model")}
            value={draft.model?.model ?? ""}
            onChange={(event) => {
              update("model", {
                model: event.target.value,
                ...(draft.model?.provider === undefined ? {} : { provider: draft.model.provider }),
              });
            }}
            placeholder={t("consultModelPlaceholder")}
          />
        </div>
        <div className={`${css.field} ${css.full}`}>
          <label className={css.label} htmlFor="expert-ai-tool-filter">
            {t("consultTools")}
          </label>
          <Input
            id="expert-ai-tool-filter"
            className={controlClass("toolFilter")}
            value={(draft.toolFilter ?? []).join(", ")}
            onChange={(event) => {
              update(
                "toolFilter",
                event.target.value
                  .split(",")
                  .map((tool) => tool.trim())
                  .filter(Boolean),
              );
            }}
            placeholder={t("consultToolsPlaceholder")}
          />
          <span className={css.hint}>{t("consultHint")}</span>
        </div>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>
            {t("persona")} {managed ? (existing ? t("personaManaged") : "") : t("personaExternal")}
          </span>
          <textarea
            className={`${css.textarea} ${invalid.has("persona") ? css.invalid : ""}`}
            rows={8}
            value={draft.persona}
            readOnly={!managed}
            onChange={(event) => {
              update("persona", event.target.value);
            }}
          />
          {!managed ? <span className={css.hint}>{t("personaReadOnly")}</span> : null}
        </label>
      </div>
    </Modal>
  );
}
