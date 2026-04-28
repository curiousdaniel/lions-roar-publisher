"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { EditSession } from "@/types";

type EditSessionContextValue = {
  session: EditSession;
  setSession: React.Dispatch<React.SetStateAction<EditSession>>;
};

const EditSessionContext = createContext<EditSessionContextValue | null>(null);

export function EditSessionProvider({
  initialSession,
  children,
}: {
  initialSession: EditSession;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState(initialSession);
  const value = useMemo(() => ({ session, setSession }), [session]);
  return <EditSessionContext.Provider value={value}>{children}</EditSessionContext.Provider>;
}

export function useEditSession() {
  const context = useContext(EditSessionContext);
  if (!context) {
    throw new Error("useEditSession must be used within EditSessionProvider");
  }
  return context;
}
