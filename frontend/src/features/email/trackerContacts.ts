import { type Application, type CustomProperty, type EmailSendContact } from "../../types";

const APP_FIELD_LABELS: Array<[string, (app: Application) => unknown]> = [
  ["Posición", (app) => app.position],
  ["Tipo de empleo", (app) => app.job_type],
  ["Ubicación", (app) => app.location],
  ["Etapa", (app) => app.stage],
  ["Resultado", (app) => app.outcome],
  ["Fecha aplicación", (app) => app.application_date],
  ["Fecha entrevista", (app) => app.interview_datetime],
  ["Fecha seguimiento", (app) => app.followup_date],
  ["Rondas entrevista", (app) => app.interview_rounds],
  ["Tipo entrevista", (app) => app.interview_type],
  ["Entrevistadores", (app) => app.interviewers],
  ["Puntuación empresa", (app) => app.company_score],
  ["Última ronda superada", (app) => app.last_round_cleared],
  ["Total rondas", (app) => app.total_rounds],
  ["Mi puntuación", (app) => app.my_interview_score],
  ["Áreas de mejora", (app) => app.improvement_areas],
  ["Skill a mejorar", (app) => app.skill_to_upgrade],
  ["Notas", (app) => app.notes],
];

const CONTACT_LIMIT_MIN = 1;
const CONTACT_LIMIT_MAX = 5000;

const normalizeLimit = (value: number): number =>
  Math.max(CONTACT_LIMIT_MIN, Math.min(CONTACT_LIMIT_MAX, Math.round(value || 0) || 500));

const toText = (value: unknown): string => String(value ?? "").trim();

const assignFieldIfPresent = (target: Record<string, string>, key: string, value: unknown) => {
  const text = toText(value);
  if (!text || text === "None" || text === "0" || text === "0.0") return;
  target[key] = text;
};

export type EmailReadContact = {
  email: string;
  name: string;
  company: string;
};

type EmailReadContactSource = {
  email?: string;
  name?: string;
  first_name?: string;
  company?: string;
};

const toReadContact = (contact: EmailReadContactSource): EmailReadContact | null => {
  const email = toText(contact.email);
  if (!email) return null;
  return {
    email,
    name: toText(contact.name) || toText(contact.first_name) || email,
    company: toText(contact.company)
  };
};

const dedupeReadContacts = (
  contacts: EmailReadContactSource[],
  shouldInclude?: (emailKey: string) => boolean
): EmailReadContact[] => {
  const deduped = new Map<string, EmailReadContact>();
  contacts.forEach((contact) => {
    const readContact = toReadContact(contact);
    if (!readContact) return;
    const emailKey = readContact.email.toLowerCase();
    if (shouldInclude && !shouldInclude(emailKey)) return;
    deduped.set(emailKey, readContact);
  });
  return Array.from(deduped.values());
};

export const buildEmailContactsFromApplications = (
  applications: Application[],
  customProperties: CustomProperty[] | undefined,
  limit: number
): EmailSendContact[] => {
  const labelByKey = new Map<string, string>();
  (customProperties || []).forEach((prop) => {
    const key = toText(prop?.key);
    const name = toText(prop?.name);
    if (!key || !name) return;
    labelByKey.set(key, name);
  });

  const contacts: EmailSendContact[] = [];
  const seen = new Set<string>();
  const limitedApplications = applications.slice(0, normalizeLimit(limit));

  limitedApplications.forEach((app) => {
    (app.contacts || []).forEach((item) => {
      const email = toText(item.email);
      if (!email) return;

      const company = toText(app.company_name);
      const dedupeKey = `${email.toLowerCase()}::${company.toLowerCase()}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const customFields: Record<string, string> = {};
      APP_FIELD_LABELS.forEach(([label, getValue]) => {
        assignFieldIfPresent(customFields, label, getValue(app));
      });

      Object.entries(app.properties || {}).forEach(([rawKey, rawValue]) => {
        if (rawValue === null || rawValue === undefined) return;
        const displayKey = labelByKey.get(rawKey) || rawKey;
        customFields[displayKey] = String(rawValue);
      });

      const name = toText(item.name);
      contacts.push({
        name,
        first_name: toText(item.first_name) || name,
        last_name: toText(item.last_name),
        email,
        company,
        custom_fields: customFields,
      });
    });
  });

  return contacts;
};

export const buildEmailReadContactsFromApplications = (
  applications: Application[],
  customProperties: CustomProperty[] | undefined,
  limit: number
): EmailReadContact[] =>
  dedupeReadContacts(
    buildEmailContactsFromApplications(applications, customProperties, limit)
  ).slice(0, normalizeLimit(limit));

export const buildSelectedEmailReadContacts = (
  contacts: EmailReadContactSource[],
  selectedRecipients: Record<string, boolean> | null | undefined
): EmailReadContact[] => {
  const selectedEmails = new Set(
    Object.entries(selectedRecipients || {})
      .filter(([, isSelected]) => Boolean(isSelected))
      .map(([email]) => toText(email).toLowerCase())
      .filter(Boolean)
  );
  if (!selectedEmails.size) return [];
  return dedupeReadContacts(contacts, (emailKey) => selectedEmails.has(emailKey)).sort((left, right) =>
    left.email.localeCompare(right.email)
  );
};
