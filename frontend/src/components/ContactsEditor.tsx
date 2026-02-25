import React, { useState } from "react";

import { Contact } from "../types";
import { generateId } from "../utils";
import { useI18n } from "../i18n";

type ContactsEditorProps = {
  contacts?: Contact[] | null;
  onCommit: (next: Contact[]) => void;
};

type ContactDraft = {
  first_name: string;
  last_name: string;
  information: string;
  email: string;
  phone: string;
};

const emptyDraft = (): ContactDraft => ({
  first_name: "",
  last_name: "",
  information: "",
  email: "",
  phone: "",
});

const buildName = (first: string, last: string): string =>
  [first, last].filter(Boolean).join(" ");

const ContactsEditor: React.FC<ContactsEditorProps> = ({ contacts, onCommit }) => {
  const { t } = useI18n();
  const list = contacts ?? [];
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ContactDraft>(emptyDraft());

  const resetDraft = () => setDraft(emptyDraft());

  const handleAdd = () => {
    const firstName = draft.first_name.trim();
    if (!firstName) return;
    const lastName = draft.last_name.trim();
    const next: Contact[] = [
      ...list,
      {
        id: generateId(),
        name: buildName(firstName, lastName),
        first_name: firstName,
        last_name: lastName || undefined,
        information: draft.information.trim() || undefined,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
      },
    ];
    onCommit(next);
    resetDraft();
  };

  const handleRemove = (id: string) => {
    const next = list.filter((contact) => contact.id !== id);
    if (next.length === list.length) return;
    onCommit(next);
  };

  const startEdit = (contact: Contact) => {
    setEditingId(contact.id);
    setEditDraft({
      first_name: contact.first_name ?? contact.name ?? "",
      last_name: contact.last_name ?? "",
      information: contact.information ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft());
  };

  const saveEdit = () => {
    if (!editingId) return;
    const firstName = editDraft.first_name.trim();
    if (!firstName) return;
    const lastName = editDraft.last_name.trim();
    const next = list.map((contact) =>
      contact.id === editingId
        ? {
            ...contact,
            name: buildName(firstName, lastName),
            first_name: firstName,
            last_name: lastName || undefined,
            information: editDraft.information.trim() || undefined,
            email: editDraft.email.trim() || undefined,
            phone: editDraft.phone.trim() || undefined,
          }
        : contact
    );
    onCommit(next);
    cancelEdit();
  };

  return (
    <div className="contacts-editor">
      <div className={`contacts-list${editingId ? " contacts-list-editing" : ""}`}>
        {list.length === 0 && <span className="contacts-empty">{t("No contacts yet.")}</span>}
        {list.map((contact) =>
          editingId === contact.id ? (
            <div className="contact-item contact-item-editing" key={contact.id}>
              <div className="contacts-edit-form">
                <input
                  value={editDraft.first_name}
                  onChange={(e) => setEditDraft((p) => ({ ...p, first_name: e.target.value }))}
                  placeholder={t("First name")}
                  autoFocus
                />
                <input
                  value={editDraft.last_name}
                  onChange={(e) => setEditDraft((p) => ({ ...p, last_name: e.target.value }))}
                  placeholder={t("Last name")}
                />
                <input
                  value={editDraft.information}
                  onChange={(e) => setEditDraft((p) => ({ ...p, information: e.target.value }))}
                  placeholder={t("Information")}
                />
                <input
                  value={editDraft.email}
                  onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))}
                  placeholder={t("Email")}
                />
                <input
                  value={editDraft.phone}
                  onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value }))}
                  placeholder={t("Phone")}
                />
                <div className="contacts-edit-actions">
                  <button className="ghost small" type="button" onClick={cancelEdit}>
                    {t("Cancel")}
                  </button>
                  <button className="primary small" type="button" onClick={saveEdit}>
                    {t("Save")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="contact-item" key={contact.id}>
              <button
                className="contact-edit-area"
                type="button"
                onClick={() => startEdit(contact)}
                title={t("Edit contact")}
              >
                <div className="contact-name">{contact.name}</div>
                <div className="contact-meta">
                  {contact.information && <span>{contact.information}</span>}
                  {contact.email && <span>{contact.email}</span>}
                  {contact.phone && <span>{contact.phone}</span>}
                </div>
              </button>
              <div className="contact-actions">
                <button
                  className="contact-action-btn"
                  type="button"
                  onClick={() => startEdit(contact)}
                  aria-label={t("Edit contact")}
                  title={t("Edit contact")}
                >
                  ✎
                </button>
                <button
                  className="contact-remove"
                  type="button"
                  onClick={() => handleRemove(contact.id)}
                  aria-label={t("Remove contact")}
                >
                  ×
                </button>
              </div>
            </div>
          )
        )}
      </div>
      <div className="contacts-form">
        <input
          value={draft.first_name}
          onChange={(e) => setDraft((p) => ({ ...p, first_name: e.target.value }))}
          placeholder={t("First name")}
        />
        <input
          value={draft.last_name}
          onChange={(e) => setDraft((p) => ({ ...p, last_name: e.target.value }))}
          placeholder={t("Last name")}
        />
        <input
          value={draft.information}
          onChange={(e) => setDraft((p) => ({ ...p, information: e.target.value }))}
          placeholder={t("Information")}
        />
        <input
          value={draft.email}
          onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
          placeholder={t("Email")}
        />
        <input
          value={draft.phone}
          onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))}
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
