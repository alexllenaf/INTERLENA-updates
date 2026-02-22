export type CommandResult = void | Promise<void>;

export interface Command {
  do(): CommandResult;
  undo(): CommandResult;
  description?: string;
  timestamp?: number;
}

type UndoListener = () => void;

type HistoryEntry = {
  id: number;
  command: Command;
};

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === "string" ? value : "Unknown error");

export class CompositeCommand implements Command {
  public readonly timestamp: number;
  public readonly description?: string;
  private readonly commands: Command[] = [];

  constructor(label?: string, timestamp = Date.now()) {
    this.description = label;
    this.timestamp = timestamp;
  }

  add(command: Command): void {
    this.commands.push(command);
  }

  get size(): number {
    return this.commands.length;
  }

  async do(): Promise<void> {
    const executed: Command[] = [];
    try {
      for (const command of this.commands) {
        await command.do();
        executed.push(command);
      }
    } catch (error) {
      for (let index = executed.length - 1; index >= 0; index -= 1) {
        try {
          await executed[index].undo();
        } catch {
          break;
        }
      }
      throw toError(error);
    }
  }

  async undo(): Promise<void> {
    const reverted: Command[] = [];
    try {
      for (let index = this.commands.length - 1; index >= 0; index -= 1) {
        const command = this.commands[index];
        await command.undo();
        reverted.push(command);
      }
    } catch (error) {
      for (let index = reverted.length - 1; index >= 0; index -= 1) {
        try {
          await reverted[index].do();
        } catch {
          break;
        }
      }
      throw toError(error);
    }
  }
}

export class UndoManager {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<UndoListener>();
  private group: CompositeCommand | null = null;
  private nextEntryId = 1;
  private checkpointIds: number[] = [];
  private _limit: number;

  constructor(limit = 100) {
    this._limit = Math.max(1, Math.floor(limit));
  }

  get limit(): number {
    return this._limit;
  }

  set limit(value: number) {
    this._limit = Math.max(1, Math.floor(value));
    this.enforceLimit();
    this.emitChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  get nextUndoDescription(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.command.description ?? null;
  }

  get nextRedoDescription(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.command.description ?? null;
  }

  get isDirty(): boolean {
    if (this.checkpointIds.length !== this.undoStack.length) return true;
    for (let index = 0; index < this.undoStack.length; index += 1) {
      if (this.undoStack[index].id !== this.checkpointIds[index]) {
        return true;
      }
    }
    return false;
  }

  subscribe(listener: UndoListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  saveCheckpoint(): void {
    this.checkpointIds = this.undoStack.map((entry) => entry.id);
    this.emitChange();
  }

  beginGroup(label?: string): void {
    if (this.group) {
      throw new Error("An undo group is already active");
    }
    this.group = new CompositeCommand(label, Date.now());
    this.emitChange();
  }

  endGroup(): void {
    if (!this.group) {
      throw new Error("No active undo group");
    }
    const closedGroup = this.group;
    this.group = null;
    if (closedGroup.size > 0) {
      this.pushUndo(closedGroup);
      this.redoStack.length = 0;
    }
    this.emitChange();
  }

  async execute(command: Command): Promise<void> {
    try {
      await command.do();
    } catch (error) {
      throw toError(error);
    }

    if (this.group) {
      this.group.add(command);
      this.emitChange();
      return;
    }

    this.pushUndo(command);
    this.redoStack.length = 0;
    this.emitChange();
  }

  async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;

    try {
      await entry.command.undo();
      this.redoStack.push(entry);
      this.emitChange();
    } catch (error) {
      this.undoStack.push(entry);
      this.emitChange();
      throw toError(error);
    }
  }

  async redo(): Promise<void> {
    const entry = this.redoStack.pop();
    if (!entry) return;

    try {
      await entry.command.do();
      this.pushUndoEntry(entry);
      this.emitChange();
    } catch (error) {
      this.redoStack.push(entry);
      this.emitChange();
      throw toError(error);
    }
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.group = null;
    this.emitChange();
  }

  private pushUndo(command: Command): void {
    this.pushUndoEntry({ id: this.nextEntryId++, command });
  }

  private pushUndoEntry(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    this.enforceLimit();
  }

  private enforceLimit(): void {
    while (this.undoStack.length > this._limit) {
      this.undoStack.shift();
    }
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}