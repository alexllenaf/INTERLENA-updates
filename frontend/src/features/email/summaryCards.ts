import { MAX_EMAIL_LOOKBACK_DAYS, MIN_EMAIL_LOOKBACK_DAYS } from "./readFilters";

export type EmailSummaryCardId =
  | "recentVolume"
  | "receivedTimeline"
  | "awaitingReply"
  | "awaitingResponse";

export type EmailSummaryMessage = {
  contactEmail: string;
  contactName: string;
  date: string;
  direction: "Recibido" | "Enviado";
};

export type EmailSummaryPendingContact = {
  contactEmail: string;
  contactName: string;
  date: string;
  daysAgo: number;
};

export type EmailSummaryTimelineBucket = {
  key: string;
  label: string;
  shortLabel: string;
  count: number;
};

export type InformationalEmailSummary = {
  recentVolume: {
    days: number;
    messageCount: number;
    contactCount: number;
  };
  receivedTimeline: {
    days: number;
    totalCount: number;
    maxCount: number;
    buckets: EmailSummaryTimelineBucket[];
  };
  awaitingReply: {
    days: number;
    count: number;
    contacts: EmailSummaryPendingContact[];
  };
  awaitingResponse: {
    days: number;
    count: number;
    contacts: EmailSummaryPendingContact[];
  };
};

export const DEFAULT_EMAIL_SUMMARY_VOLUME_DAYS = 7;
export const DEFAULT_EMAIL_SUMMARY_TIMELINE_DAYS = 14;
export const DEFAULT_EMAIL_SUMMARY_AWAITING_REPLY_DAYS = 14;
export const DEFAULT_EMAIL_SUMMARY_AWAITING_RESPONSE_DAYS = 14;

export const EMAIL_SUMMARY_CARD_LABELS: Record<EmailSummaryCardId, string> = {
  recentVolume: "Correos recientes",
  receivedTimeline: "Mensajes recibidos",
  awaitingReply: "Pendientes de contestacion",
  awaitingResponse: "Pendientes de contestar"
};

export const DEFAULT_EMAIL_SUMMARY_CARD_ORDER: EmailSummaryCardId[] = [
  "recentVolume",
  "receivedTimeline",
  "awaitingReply",
  "awaitingResponse"
];

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (value: Date): Date => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (value: Date, days: number): Date => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const formatBucketKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildWindowStart = (days: number, now: Date): Date => addDays(startOfDay(now), -(Math.max(1, days) - 1));

const parseTimestamp = (value: string): number | null => {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
};

const daysAgoFrom = (timestamp: number, now: Date): number => {
  const diff = startOfDay(now).getTime() - startOfDay(new Date(timestamp)).getTime();
  return Math.max(0, Math.floor(diff / DAY_MS));
};

const filterMessagesWithinDays = <T extends Pick<EmailSummaryMessage, "date">>(
  messages: T[],
  days: number,
  now: Date
): Array<T & { timestamp: number }> => {
  const cutoff = buildWindowStart(days, now).getTime();
  return messages
    .map((message) => {
      const timestamp = parseTimestamp(message.date);
      if (timestamp === null || timestamp < cutoff) return null;
      return { ...message, timestamp };
    })
    .filter((message): message is T & { timestamp: number } => Boolean(message));
};

const buildPendingContacts = (
  messages: EmailSummaryMessage[],
  days: number,
  direction: "Recibido" | "Enviado",
  now: Date
): {
  days: number;
  count: number;
  contacts: EmailSummaryPendingContact[];
} => {
  const recentMessages = filterMessagesWithinDays(messages, days, now);
  const latestByContact = new Map<string, (typeof recentMessages)[number]>();
  recentMessages.forEach((message) => {
    const key = message.contactEmail.trim().toLowerCase();
    if (!key) return;
    const existing = latestByContact.get(key);
    if (!existing || message.timestamp > existing.timestamp) {
      latestByContact.set(key, message);
    }
  });
  const contacts = Array.from(latestByContact.values())
    .filter((message) => message.direction === direction)
    .sort((left, right) => right.timestamp - left.timestamp)
    .map((message) => ({
      contactEmail: message.contactEmail,
      contactName: message.contactName || message.contactEmail,
      date: message.date,
      daysAgo: daysAgoFrom(message.timestamp, now)
    }));
  return {
    days,
    count: contacts.length,
    contacts
  };
};

export const normalizeEmailSummaryDays = (value: unknown, fallback: number): number => {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(MIN_EMAIL_LOOKBACK_DAYS, Math.min(MAX_EMAIL_LOOKBACK_DAYS, numeric));
};

export const normalizeEmailSummaryCardOrder = (raw: unknown): EmailSummaryCardId[] => {
  const valid = new Set(DEFAULT_EMAIL_SUMMARY_CARD_ORDER);
  const normalized = Array.isArray(raw)
    ? raw.filter((value): value is EmailSummaryCardId => typeof value === "string" && valid.has(value as EmailSummaryCardId))
    : [];
  const unique = Array.from(new Set(normalized));
  DEFAULT_EMAIL_SUMMARY_CARD_ORDER.forEach((cardId) => {
    if (!unique.includes(cardId)) unique.push(cardId);
  });
  return unique;
};

export const moveEmailSummaryCard = (
  order: EmailSummaryCardId[],
  cardId: EmailSummaryCardId,
  offset: -1 | 1
): EmailSummaryCardId[] => {
  const index = order.indexOf(cardId);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = [...order];
  const [item] = next.splice(index, 1);
  if (!item) return order;
  next.splice(nextIndex, 0, item);
  return next;
};

export const limitEmailMessagesPerContact = <T extends Pick<EmailSummaryMessage, "contactEmail">>(
  messages: T[],
  limit: number
): T[] => {
  const normalizedLimit = Math.max(1, Math.round(Number(limit) || 1));
  const counts = new Map<string, number>();
  return messages.filter((message) => {
    const key = String(message.contactEmail || "").trim().toLowerCase();
    if (!key) return false;
    const count = counts.get(key) || 0;
    if (count >= normalizedLimit) return false;
    counts.set(key, count + 1);
    return true;
  });
};

export const buildInformationalEmailSummary = (
  messages: EmailSummaryMessage[],
  config: {
    recentVolumeDays: number;
    timelineDays: number;
    awaitingReplyDays: number;
    awaitingResponseDays: number;
    now?: Date;
  }
): InformationalEmailSummary => {
  const now = config.now || new Date();
  const recentVolumeMessages = filterMessagesWithinDays(messages, config.recentVolumeDays, now);
  const recentVolumeContacts = new Set(
    recentVolumeMessages.map((message) => String(message.contactEmail || "").trim().toLowerCase()).filter(Boolean)
  );

  const timelineStart = buildWindowStart(config.timelineDays, now);
  const receivedMessages = filterMessagesWithinDays(messages, config.timelineDays, now).filter(
    (message) => message.direction === "Recibido"
  );
  const countsByDay = new Map<string, number>();
  receivedMessages.forEach((message) => {
    const key = formatBucketKey(startOfDay(new Date(message.timestamp)));
    countsByDay.set(key, (countsByDay.get(key) || 0) + 1);
  });
  const timelineFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
  const timelineShortFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric" });
  const buckets: EmailSummaryTimelineBucket[] = [];
  for (let index = 0; index < config.timelineDays; index += 1) {
    const date = addDays(timelineStart, index);
    const key = formatBucketKey(date);
    buckets.push({
      key,
      label: timelineFormatter.format(date),
      shortLabel: timelineShortFormatter.format(date),
      count: countsByDay.get(key) || 0
    });
  }
  const maxCount = buckets.reduce((highest, bucket) => Math.max(highest, bucket.count), 0);

  return {
    recentVolume: {
      days: config.recentVolumeDays,
      messageCount: recentVolumeMessages.length,
      contactCount: recentVolumeContacts.size
    },
    receivedTimeline: {
      days: config.timelineDays,
      totalCount: receivedMessages.length,
      maxCount,
      buckets
    },
    awaitingReply: buildPendingContacts(messages, config.awaitingReplyDays, "Enviado", now),
    awaitingResponse: buildPendingContacts(messages, config.awaitingResponseDays, "Recibido", now)
  };
};
