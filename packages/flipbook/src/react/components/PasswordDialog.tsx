"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { PasswordReason } from "../../pdf/types.js";
import type { FlipBookLocale } from "../../types/index.js";

export interface PasswordDialogProps {
  reason: PasswordReason;
  locale: FlipBookLocale;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

const button: CSSProperties = {
  padding: "8px 14px",
  border: "1px solid rgba(127, 127, 127, 0.45)",
  borderRadius: 8,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

/** Built-in password prompt. Replace it with the `onPassword` prop. */
export function PasswordDialog({ reason, locale, onSubmit, onCancel }: PasswordDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onCancel();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onKeyDown={onKeyDown}
      style={{
        width: "min(360px, calc(100% - 32px))",
        boxSizing: "border-box",
        padding: 20,
        borderRadius: 12,
        background: "var(--flipbook-toolbar-background, rgba(255, 255, 255, 0.92))",
        color: "var(--flipbook-toolbar-color, #1f2328)",
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.18)",
        font: "14px/1.5 system-ui, sans-serif",
      }}
    >
      <h2 id={titleId} style={{ margin: "0 0 6px", font: "600 16px/1.3 system-ui, sans-serif" }}>
        {locale.passwordTitle}
      </h2>
      <p id={messageId} style={{ margin: "0 0 14px" }}>
        {locale.passwordMessage}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <label style={{ display: "block", marginBottom: 6 }}>
          {locale.passwordLabel}
          <input
            ref={inputRef}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={reason === "incorrect"}
            aria-describedby={reason === "incorrect" ? `${messageId}-error` : undefined}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              marginTop: 4,
              padding: "8px 10px",
              border: "1px solid rgba(127, 127, 127, 0.55)",
              borderRadius: 8,
              background: "transparent",
              color: "inherit",
              font: "inherit",
            }}
          />
        </label>
        {reason === "incorrect" ? (
          <p id={`${messageId}-error`} role="alert" style={{ margin: "6px 0 0", color: "#c0392b" }}>
            {locale.passwordIncorrect}
          </p>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" style={button} onClick={onCancel}>
            {locale.passwordCancel}
          </button>
          <button
            type="submit"
            style={{
              ...button,
              background: "var(--flipbook-accent, #2563eb)",
              borderColor: "transparent",
              color: "#fff",
            }}
          >
            {locale.passwordSubmit}
          </button>
        </div>
      </form>
    </div>
  );
}
