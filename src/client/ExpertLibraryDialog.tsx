import { useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, IconSearchOutlineRegular, Input, Modal, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ExpertCatalogEntry } from "../expert-types.js";
import type { ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { errorText } from "./controls.js";
import css from "./settings.module.css";

/** Default source branch. */
const DEFAULT_REF = "main";

/**
 * Browse the mimeographs catalog on a branch or tag and import one expert package.
 * @returns The library dialog.
 */
export function ExpertLibraryDialog({
  api,
  writable,
  t,
  onImported,
  onClose,
}: {
  api: Pick<ExpertWorkbenchApi, "catalog" | "importExpert">;
  writable: boolean;
  t: TranslateNS<"expert-ai">;
  /** Called with the imported record id. */
  onImported: (id: string) => void;
  onClose: () => void;
}): ReactNode {
  const [ref, setRef] = useState(DEFAULT_REF);
  // Branch or tag the shown catalog was loaded from; imports use it.
  const [loadedRef, setLoadedRef] = useState("");
  const [offline, setOffline] = useState(false);
  const [catalog, setCatalog] = useState<ExpertCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const needle = query.trim().toLowerCase();
  const choices = catalog.filter((entry) =>
    `${entry.name} ${entry.slug} ${entry.description}`.toLowerCase().includes(needle),
  );
  const chosen = catalog.find((entry) => entry.slug === selected);

  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const load = (): void => {
    void perform(async () => {
      const loaded = await api.catalog(ref.trim());
      setLoadedRef(loaded.ref);
      setOffline(loaded.cached);
      setCatalog(loaded.experts);
      setSelected(loaded.experts[0]?.slug ?? "");
    });
  };
  const importChosen = (): void => {
    void perform(async () => {
      onImported(await api.importExpert(selected, loadedRef));
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("expertLibrary")}
      description={t("expertLibraryHint")}
      closeLabel={t("close")}
      className={css.dialogNarrow ?? ""}
      contentClassName={css.dialogContent ?? ""}
      footer={
        <>
          {error === undefined ? null : (
            <span className={`${css.error} ${css.grow}`} role="alert">
              {error}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !writable || chosen === undefined || loadedRef === ""} onClick={importChosen}>
            {t("importExpert")}
          </Button>
        </>
      }
    >
      <div className={css.panel}>
        <div className={css.field}>
          <label className={css.label} htmlFor="expert-ai-revision">
            {t("expertRevision")}
          </label>
          <div className={css.fileRow}>
            <Input
              id="expert-ai-revision"
              className={`${css.control} ${css.grow}`}
              value={ref}
              placeholder={DEFAULT_REF}
              spellCheck={false}
              disabled={busy}
              onChange={(event) => {
                setRef(event.target.value);
                setLoadedRef("");
                setCatalog([]);
                setSelected("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy && ref.trim() !== "") load();
              }}
            />
            <Button variant="outline" disabled={busy || ref.trim() === ""} onClick={load} data-modal-autofocus="">
              {t("loadExpertCatalog")}
            </Button>
          </div>
          {loadedRef === "" || !offline ? null : <span className={css.hint}>{t("expertRevisionCached")}</span>}
        </div>
        {catalog.length === 0 ? null : (
          <>
            <Input
              className={css.control ?? ""}
              icon={<IconSearchOutlineRegular size={16} />}
              value={query}
              placeholder={t("searchExperts")}
              aria-label={t("searchExperts")}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <div className={css.catalog} role="listbox" aria-label={t("chooseExpert")}>
              {choices.length === 0 ? (
                <span className={`${css.muted} ${css.catalogItem}`}>{t("noMatches")}</span>
              ) : (
                choices.map((entry) => (
                  <button
                    key={entry.slug}
                    type="button"
                    role="option"
                    aria-selected={entry.slug === selected}
                    className={css.catalogItem}
                    onClick={() => {
                      setSelected(entry.slug);
                    }}
                  >
                    <span>{entry.name}</span>
                    <small>{entry.slug}</small>
                  </button>
                ))
              )}
            </div>
            {chosen === undefined ? null : (
              <div className={css.field}>
                <div className={css.tagRow}>
                  <Tag tone="info">{t("expertPublicMethod")}</Tag>
                  <Tag tone="warning">{t("expertUnreviewed")}</Tag>
                </div>
                <p className={css.muted}>{chosen.description}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
