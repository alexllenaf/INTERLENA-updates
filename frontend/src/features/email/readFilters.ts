import { type EmailMetadata, type GoogleAccount } from "../../types";

export const READ_MAILBOX_ALL = "ALL";
export const READ_MAILBOX_INBOX = "INBOX";
export const READ_MAILBOX_SENT = "SENT";
export const MIN_EMAIL_LOOKBACK_DAYS = 1;
export const MAX_EMAIL_LOOKBACK_DAYS = 365;

type EmailAccountScopedMessage = Pick<EmailMetadata, "folder" | "from_address" | "to_address">;

export const normalizeMailboxName = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return READ_MAILBOX_INBOX;
  const upper = trimmed.toUpperCase();
  if (upper === READ_MAILBOX_ALL) return READ_MAILBOX_ALL;
  if (upper === READ_MAILBOX_INBOX) return READ_MAILBOX_INBOX;
  if (upper === READ_MAILBOX_SENT) return READ_MAILBOX_SENT;
  return trimmed;
};

export const isInboxMailbox = (value: string): boolean => {
  const upper = String(value || "").trim().toUpperCase();
  if (!upper) return false;
  return upper === READ_MAILBOX_INBOX || upper.includes("INBOX");
};

export const isSentMailbox = (value: string): boolean => {
  const upper = String(value || "").trim().toUpperCase();
  if (!upper) return false;
  return upper === READ_MAILBOX_SENT || upper.includes("SENT");
};

export const formatMailboxLabel = (value: string): string => {
  const normalized = normalizeMailboxName(value);
  if (normalized === READ_MAILBOX_ALL) return "Todas las entradas";
  if (isInboxMailbox(normalized)) return "Entrada";
  if (isSentMailbox(normalized)) return "Enviados";
  return normalized;
};

export const resolveEmailMetadataFolderParam = (value: string | null | undefined): string | undefined => {
  const normalized = normalizeMailboxName(String(value || "").trim() || READ_MAILBOX_ALL);
  return normalized === READ_MAILBOX_ALL ? undefined : normalized;
};

export const normalizeEmailLookbackDays = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(MIN_EMAIL_LOOKBACK_DAYS, Math.min(MAX_EMAIL_LOOKBACK_DAYS, numeric));
};

export const formatIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const buildLookbackStartDate = (days: number): string => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - days);
  return formatIsoDate(now);
};

export const buildEmailAccountOptions = (
  googleAccounts: Array<Pick<GoogleAccount, "email">>,
  ...extraValues: Array<string | null | undefined>
): string[] => {
  const values = [
    READ_MAILBOX_ALL,
    ...googleAccounts.map((account) => String(account.email || "").trim()),
    ...extraValues.map((value) => String(value || "").trim())
  ].filter(Boolean);
  return Array.from(new Set(values));
};

export const filterEmailMessagesByAccount = <T extends EmailAccountScopedMessage>(
  messages: T[],
  accountFilter: string
): T[] => {
  const accountNeedle = accountFilter === READ_MAILBOX_ALL ? "" : accountFilter.trim().toLowerCase();
  if (!accountNeedle) return messages;
  return messages.filter((message) => {
    const folder = String(message.folder || "");
    const fromValue = String(message.from_address || "");
    const toValue = String(message.to_address || "");
    const accountFields =
      isSentMailbox(folder) ? [fromValue] :
      isInboxMailbox(folder) ? [toValue, fromValue] :
      [fromValue, toValue];
    return accountFields.some((value) => value.toLowerCase().includes(accountNeedle));
  });
};
