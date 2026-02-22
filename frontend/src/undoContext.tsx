import React, { createContext, useContext } from "react";
import { Command, UndoManager } from "./shared/undoManager";

type UndoContextValue = {
  undoManager: UndoManager;
  executeCommand: (command: Command) => Promise<void>;
};

const UndoContext = createContext<UndoContextValue | null>(null);

export const UndoProvider: React.FC<{
  undoManager: UndoManager;
  children: React.ReactNode;
}> = ({ undoManager, children }) => {
  const executeCommand = async (command: Command) => {
    try {
      await undoManager.execute(command);
    } catch (err) {
      console.error("Command execution failed:", err);
      throw err;
    }
  };

  return (
    <UndoContext.Provider value={{ undoManager, executeCommand }}>
      {children}
    </UndoContext.Provider>
  );
};

export const useUndo = (): UndoContextValue => {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    throw new Error("useUndo must be used inside UndoProvider");
  }
  return ctx;
};
