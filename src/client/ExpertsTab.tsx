import { useRef, useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  IconChevronDownOutlineMedium,
  IconEditOutlineRegular,
  IconPlusOutlineMedium,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Menu,
  MenuItemButton,
  Pill,
  RiskConfirmation,
  Switch,
  Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ExpertRecord, ExpertSettings } from "../types.js";
import type { ExpertTeam } from "../expert-types.js";
import { EXPERT_AI_CATEGORIES } from "../constants.js";
import { applyAgentMarkdown } from "./agent-file.js";
import { errorText } from "./controls.js";
import { ExpertEditor } from "./ExpertEditor.js";
import { ExpertLibraryDialog } from "./ExpertLibraryDialog.js";
import type { ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { categoryLabel } from "./locales.js";
import { EMPTY_RECORD, normalizeExpertRecord } from "./records.js";
import { teamsUsing } from "./teams.js";
import css from "./settings.module.css";

type Editing = { record: ExpertRecord; existing: boolean; importedFile?: string };

/**
 * List, search, add, import, edit, enable, and delete digital-life records.
 * @returns The 专家 tab panel body.
 */
export function ExpertsTab({
  records,
  teams,
  writable,
  form,
  loadIdentity,
  expertApi,
  t,
  notify,
}: {
  records: readonly ExpertRecord[];
  teams: readonly ExpertTeam[];
  writable: boolean;
  form: ConfigForm<ExpertSettings>;
  loadIdentity: (id: string) => Promise<string>;
  expertApi: ExpertWorkbenchApi;
  t: TranslateNS<"digital-life">;
  /** Show a transient confirmation. */
  notify: (text: string) => void;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<ExpertRecord | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = new Set(records.map((record) => record.id));

  const needle = query.trim().toLowerCase();
  const visible = records.filter(
    (record) =>
      (category === "all" || record.category === category) &&
      (needle === "" ||
        `${record.name} ${record.id} ${record.tags.join(" ")}`.toLowerCase().includes(needle)),
  );
  const usedCategories = EXPERT_AI_CATEGORIES.filter((value) => records.some((record) => record.category === value));

  const writeRecords = async (next: ExpertRecord[]): Promise<boolean> => form.set("records", next);
  const beginEdit = (record: ExpertRecord): void => {
    setError(undefined);
    setBusy(true);
    void loadIdentity(record.id)
      .then((identity) => {
        setEditing({
          record: {
            ...record,
            persona: identity,
            ...(record.toolFilter === undefined ? {} : { toolFilter: [...record.toolFilter] }),
          },
          existing: true,
        });
      })
      .catch((reason: unknown) => {
        setError(errorText(reason));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const importFile = async (file: File): Promise<void> => {
    try {
      const record = applyAgentMarkdown(await file.text(), file.name, { ...EMPTY_RECORD });
      if (record === undefined) throw new Error(t("identityError"));
      setEditing({ record, existing: false, importedFile: file.name });
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const save = async (draft: ExpertRecord): Promise<string | undefined> => {
    if (editing === undefined) return undefined;
    const next = normalizeExpertRecord(draft);
    const editingId = editing.existing ? editing.record.id : undefined;
    const nextRecords =
      editingId === undefined
        ? [...records, next]
        : records.map((record) => (record.id === editingId ? next : record));
    try {
      if (!(await writeRecords(nextRecords))) return t("writeFailed");
    } catch (reason) {
      return errorText(reason);
    }
    // SettingsScope publishes the refreshed snapshot asynchronously after
    // the wire write. Do not inspect the old snapshot here: it can still
    // contain the pre-save records even when the write succeeded.
    setEditing(undefined);
    notify(t("saved"));
    return undefined;
  };
  const toggle = (record: ExpertRecord, enabled: boolean): void => {
    void writeRecords(records.map((item) => (item.id === record.id ? { ...item, enabled } : item)))
      .then((saved) => {
        if (!saved) setError(t("writeFailed"));
      })
      .catch((reason: unknown) => {
        setError(errorText(reason));
      });
  };
  const confirmDelete = (): void => {
    if (deleting === undefined) return;
    setBusy(true);
    void writeRecords(records.filter((record) => record.id !== deleting.id))
      .then((deleted) => {
        if (!deleted) {
          setError(t("writeFailed"));
          return;
        }
        notify(t("deleted"));
      })
      .catch((reason: unknown) => {
        setError(errorText(reason));
      })
      .finally(() => {
        setBusy(false);
        setDeleting(undefined);
        setAcknowledged(false);
      });
  };
  const referencing = deleting === undefined ? [] : teamsUsing(deleting.id, teams);

  return (
    <>
      <div className={css.toolbar}>
        <Input
          className={css.grow ?? ""}
          icon={<IconSearchOutlineRegular size={16} />}
          value={query}
          placeholder={t("searchRecords")}
          aria-label={t("searchRecords")}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <Menu
          open={importOpen}
          onClose={() => {
            setImportOpen(false);
          }}
          align="end"
          portal
          anchor={
            <Button
              variant="outline"
              aria-haspopup="menu"
              aria-expanded={importOpen}
              disabled={!writable}
              onClick={() => {
                setImportOpen((open) => !open);
              }}
            >
              {t("importMenu")}
              <IconChevronDownOutlineMedium size={14} />
            </Button>
          }
        >
          <MenuItemButton
            onSelect={() => {
              setImportOpen(false);
              fileInput.current?.click();
            }}
          >
            {t("importFromFile")}
          </MenuItemButton>
          <MenuItemButton
            onSelect={() => {
              setImportOpen(false);
              setLibrary(true);
            }}
          >
            {t("importFromLibrary")}
          </MenuItemButton>
        </Menu>
        <Button
          variant="primary"
          icon={<IconPlusOutlineMedium size={16} />}
          disabled={!writable}
          onClick={() => {
            setError(undefined);
            setEditing({ record: { ...EMPTY_RECORD }, existing: false });
          }}
        >
          {t("add")}
        </Button>
        <input
          ref={fileInput}
          className={css.hiddenFile}
          type="file"
          accept=".md,text/markdown,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void importFile(file);
            event.target.value = "";
          }}
        />
      </div>
      {usedCategories.length < 2 ? null : (
        <div className={css.filters} role="group" aria-label={t("category")}>
          <Pill
            active={category === "all"}
            onClick={() => {
              setCategory("all");
            }}
          >
            {t("filterAll")}
          </Pill>
          {usedCategories.map((value) => (
            <Pill
              key={value}
              active={category === value}
              onClick={() => {
                setCategory(value);
              }}
            >
              {categoryLabel({ category: value }, t)}
            </Pill>
          ))}
        </div>
      )}
      {error === undefined ? null : (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={css.list}>
        {records.length === 0 ? (
          <div className={css.empty}>{t("empty")}</div>
        ) : visible.length === 0 ? (
          <div className={css.empty}>{t("noMatches")}</div>
        ) : (
          visible.map((record) => (
            <article className={css.card} key={record.id}>
              <div className={css.cardMain}>
                <div className={css.identity}>
                  <strong>{record.name}</strong>
                  <Tag tone="neutral">{categoryLabel(record, t)}</Tag>
                  <code className={css.code}>@{record.id}</code>
                  {record.expertPackage === undefined ? null : (
                    <>
                      <Tag tone="info">{t("expertPublicMethod")}</Tag>
                      <Tag tone="warning">{t("expertUnreviewed")}</Tag>
                      {/* Packages imported before refs were recorded only carry their commit. */}
                      <code className={css.code}>{record.expertPackage.ref ?? record.expertPackage.revision.slice(0, 7)}</code>
                    </>
                  )}
                </div>
                {record.tags.length === 0 ? null : (
                  <div className={css.tagRow} title={record.tags.join(" · ")}>
                    {record.tags.map((tag) => (
                      <Tag key={tag} tone="outline">
                        {tag}
                      </Tag>
                    ))}
                  </div>
                )}
                <p className={css.preview}>{record.description}</p>
              </div>
              <div className={css.actions}>
                <Switch
                  checked={record.enabled}
                  label={`${t("enabled")} @${record.id}`}
                  title={t("enabled")}
                  disabled={!writable}
                  onChange={(enabled) => {
                    toggle(record, enabled);
                  }}
                />
                <Button
                  size="sm"
                  icon={<IconEditOutlineRegular size={14} />}
                  disabled={busy}
                  onClick={() => {
                    beginEdit(record);
                  }}
                >
                  {t("edit")}
                </Button>
                <Button
                  size="sm"
                  icon={<IconTrashOutlineRegular size={14} />}
                  disabled={!writable || busy}
                  onClick={() => {
                    setAcknowledged(false);
                    setDeleting(record);
                  }}
                >
                  {t("remove")}
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
      {editing === undefined ? null : (
        <ExpertEditor
          initial={editing.record}
          existing={editing.existing}
          importedFile={editing.importedFile}
          ids={ids}
          t={t}
          onSave={save}
          onCancel={() => {
            setEditing(undefined);
          }}
        />
      )}
      {library ? (
        <ExpertLibraryDialog
          api={expertApi}
          writable={writable}
          t={t}
          onImported={(id) => {
            setLibrary(false);
            notify(t("expertImported", { id }));
          }}
          onClose={() => {
            setLibrary(false);
          }}
        />
      ) : null}
      <RiskConfirmation
        open={deleting !== undefined}
        title={t("deleteRecordTitle", { name: deleting?.name ?? "" })}
        description={
          referencing.length === 0
            ? t("deleteRecordDescription", { id: deleting?.id ?? "" })
            : t("deleteRecordInUse", {
                id: deleting?.id ?? "",
                teams: referencing.map((team) => team.name).join("、"),
              })
        }
        acknowledgeLabel={t("deleteAcknowledge")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        confirmLabel={t("confirmDelete")}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setDeleting(undefined);
          setAcknowledged(false);
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}
