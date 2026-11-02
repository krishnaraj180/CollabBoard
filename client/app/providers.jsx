"use client";

import { AuthProvider } from "../src/context/AuthContext";
import { NavProvider } from "../src/context/NavContext";
import { RealtimeProvider } from "../src/context/RealtimeContext";

export default function Providers({ children }) {
  return (
    <AuthProvider>
      <RealtimeProvider>
        <NavProvider>{children}</NavProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
