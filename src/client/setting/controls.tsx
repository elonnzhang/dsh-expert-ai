import { useState, type ReactNode } from "react";
import { Button, IconChevronDownOutlineMedium, Menu, type MenuItem } from "@deepseek-ai/dsh-client-ui-primitives";
import css from "./settings.module.css";

/** One option of a {@link MenuSelect}. */
export interface MenuSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * A single-choice picker built from the primitive Menu, standing in for a
 * native select so dialogs keep the shared control look.
 * @returns The trigger button with its anchored menu.
 */
export function MenuSelect({
  id,
  value,
  options,
  placeholder,
  invalid = false,
  disabled = false,
  onChange,
}: {
  id?: string;
  value: string;
  options: readonly MenuSelectOption[];
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  const items: MenuItem[] = options.map((option) => ({
    id: option.value,
    label: option.label,
    ...(option.disabled === true ? { disabled: true } : {}),
  }));
  return (
    <Menu
      className={css.selectWrap}
      open={open}
      items={items}
      selectedId={chosen?.value}
      onSelect={(next) => {
        setOpen(false);
        onChange(next);
      }}
      onClose={() => {
        setOpen(false);
      }}
      align="start"
      portal
      anchor={
        <Button
          {...(id === undefined ? {} : { id })}
          variant="outline"
          className={`${css.select} ${invalid ? css.invalid : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          <span>{chosen?.label ?? placeholder}</span>
          <IconChevronDownOutlineMedium size={14} />
        </Button>
      }
    />
  );
}

/** Report an error thrown by an async action as display text. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
