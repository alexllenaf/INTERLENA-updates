import React, { useState } from "react";

import { Contact } from "../types";
import { generateId } from "../utils";
import { useI18n } from "../i18n";

type ContactsEditorProps = {
  contacts?: Contact[] | null;
  onCommit: (next: Contact[]) => void;
};

const ContactsEditor: React.FC<ContactsEditorProps> = ({ contacts, onCommit }) => {
  const { t } = useI18n();
  const list = contacts ?? [];
  const [draft, setDraft] = useState({
    name: "",
    information: "",
    email: "",
    phone: ""
  });

  const resetDraft = () =>
    setDraft({
      name: "",
      information: "",
      email: "",
      phone: ""
    });

  const handleAdd = () => {
    const name = draft.name.trim();
    if (!name) return;
    const next: Contact[] = [
      ...list,
      {
        id: generateId(),
        name,
        information: draft.information.trim() || undefined,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined
      }
    ];
    onCommit(next);
    resetDraft();
  };

  const handleRemove = (id: string) => {
    const next = list.filter((contact) => contact.id !== id);
    if (next.length === list.length) return;
    onCommit(next);
  };

  return (
    <div className="contacts-editor">
      <div className="contacts-list">
        {list.length === 0 && <span className="contacts-empty">{t("No contacts yet.")}</span>}
        {list.map((contact) => (
          <div className="contact-item" key={contact.id}>
            <div className="contact-name">{contact.name}</div>
            <div className="contact-meta">
              {contact.information && <span>{contact.information}</span>}
              {contact.email && <span>{contact.email}</span>}
              {contact.phone && <span>{contact.phone}</span>}
            </div>
            <button
              className="contact-remove"
              type="button"
              onClick={() => handleRemove(contact.id)}
              aria-label={t("Remove contact")}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="contacts-form">
        <input
          value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          placeholder={t("Name")}
        />
        <input
          value={draft.information}
          onChange={(event) => setDraft((prev) => ({ ...prev, information: event.target.value }))}
          placeholder={t("Information")}
        />
        <input
          value={draft.email}
          onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
          placeholder={t("Email")}
        />
        <input
          value={draft.phone}
          onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))}
          placeholder={t("Phone")}
        />
        <button className="primary small" type="button" onClick={handleAdd}>
          {t("Add contact")}
        </button>
      </div>
    </div>
  );
};

export default ContactsEditor;
