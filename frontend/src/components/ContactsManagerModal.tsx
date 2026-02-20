import React, { useState } from "react";
import type { Contact } from "../types";
import { generateId } from "../utils";

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

export type ContactsManagerModalProps = {
  contacts: Contact[];
  onCommit: (next: Contact[]) => void;
  onClose: () => void;
};

const ContactsManagerModal: React.FC<ContactsManagerModalProps> = ({
  contacts,
  onCommit,
  onClose,
}) => {
  const list = contacts;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ContactDraft>(emptyDraft());
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<ContactDraft>(emptyDraft());

  /* ── Edit ─────────────────────────────── */
  const startEdit = (c: Contact) => {
    setEditingId(c.id);
    setEditDraft({
      first_name: c.first_name ?? c.name ?? "",
      last_name: c.last_name ?? "",
      information: c.information ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
    });
    setAddOpen(false);
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
    const next = list.map((c) =>
      c.id === editingId
        ? {
            ...c,
            name: buildName(firstName, lastName),
            first_name: firstName,
            last_name: lastName || undefined,
            information: editDraft.information.trim() || undefined,
            email: editDraft.email.trim() || undefined,
            phone: editDraft.phone.trim() || undefined,
          }
        : c
    );
    onCommit(next);
    cancelEdit();
  };

  /* ── Remove ───────────────────────────── */
  const handleRemove = (id: string) => {
    onCommit(list.filter((c) => c.id !== id));
  };

  /* ── Add ──────────────────────────────── */
  const openAdd = () => {
    setAddOpen(true);
    setAddDraft(emptyDraft());
    cancelEdit();
  };

  const handleAdd = () => {
    const firstName = addDraft.first_name.trim();
    if (!firstName) return;
    const lastName = addDraft.last_name.trim();
    const newContact: Contact = {
      id: generateId(),
      name: buildName(firstName, lastName),
      first_name: firstName,
      last_name: lastName || undefined,
      information: addDraft.information.trim() || undefined,
      email: addDraft.email.trim() || undefined,
      phone: addDraft.phone.trim() || undefined,
    };
    onCommit([...list, newContact]);
    setAddDraft(emptyDraft());
    setAddOpen(false);
  };

  /* ── Render helpers ───────────────────── */
  const renderForm = (
    draft: ContactDraft,
    setDraft: React.Dispatch<React.SetStateAction<ContactDraft>>,
    onSave: () => void,
    onCancel: () => void,
    saveLabel: string
  ) => (
    <div className="cm-form">
      <div className="cm-form-row">
        <label>
          <span>Nombre</span>
          <input
            value={draft.first_name}
            onChange={(e) => setDraft((p) => ({ ...p, first_name: e.target.value }))}
            placeholder="Nombre"
            autoFocus
          />
        </label>
        <label>
          <span>Apellido</span>
          <input
            value={draft.last_name}
            onChange={(e) => setDraft((p) => ({ ...p, last_name: e.target.value }))}
            placeholder="Apellido"
          />
        </label>
      </div>
      <label>
        <span>Información</span>
        <input
          value={draft.information}
          onChange={(e) => setDraft((p) => ({ ...p, information: e.target.value }))}
          placeholder="Cargo, LinkedIn, etc."
        />
      </label>
      <div className="cm-form-row">
        <label>
          <span>Email</span>
          <input
            value={draft.email}
            onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
            placeholder="nombre@email.com"
          />
        </label>
        <label>
          <span>Teléfono</span>
          <input
            value={draft.phone}
            onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))}
            placeholder="+34 ..."
          />
        </label>
      </div>
      <div className="cm-form-actions">
        <button className="ghost small" type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary small" type="button" onClick={onSave}>
          {saveLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal cm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cm-header">
          <h3>Gestionar contactos</h3>
          <button className="cm-close" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {/* Contact list */}
        <div className="cm-list">
          {list.length === 0 && !addOpen && (
            <p className="cm-empty">No hay contactos. Haz clic en «Añadir contacto» para crear uno.</p>
          )}
          {list.map((c) =>
            editingId === c.id ? (
              <div className="cm-card cm-card-editing" key={c.id}>
                {renderForm(editDraft, setEditDraft, saveEdit, cancelEdit, "Guardar")}
              </div>
            ) : (
              <div className="cm-card" key={c.id}>
                <button
                  className="cm-card-body"
                  type="button"
                  onClick={() => startEdit(c)}
                  title="Editar contacto"
                >
                  <div className="cm-card-name">{c.name}</div>
                  <div className="cm-card-meta">
                    {c.information && <span>{c.information}</span>}
                    {c.email && <span>✉ {c.email}</span>}
                    {c.phone && <span>☎ {c.phone}</span>}
                  </div>
                </button>
                <div className="cm-card-actions">
                  <button
                    className="cm-card-action"
                    type="button"
                    onClick={() => startEdit(c)}
                    title="Editar"
                  >
                    ✎
                  </button>
                  <button
                    className="cm-card-action cm-card-action-danger"
                    type="button"
                    onClick={() => handleRemove(c.id)}
                    title="Eliminar"
                  >
                    🗑
                  </button>
                </div>
              </div>
            )
          )}
        </div>

        {/* Add new contact */}
        {addOpen ? (
          <div className="cm-add-section">
            <h4>Nuevo contacto</h4>
            {renderForm(addDraft, setAddDraft, handleAdd, () => setAddOpen(false), "Añadir")}
          </div>
        ) : (
          <button className="primary small cm-add-btn" type="button" onClick={openAdd}>
            + Añadir contacto
          </button>
        )}
      </div>
    </div>
  );
};

export default ContactsManagerModal;
