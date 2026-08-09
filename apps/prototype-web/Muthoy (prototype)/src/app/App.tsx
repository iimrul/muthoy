import { RouterProvider } from "react-router";
import { router, PageLoader } from "./router";
import { runMigrations } from "./utils/migrations";
import { preloadCriticalRoutes } from "./utils/preloadRoutes";
import { LanguageProvider } from "./contexts/LanguageContext";
import { CartProvider } from "./contexts/CartContext";
import { AuthProvider } from "./contexts/AuthContext";
import { AuditLogProvider } from "./contexts/AuditLogContext";
import { Toaster } from "sonner";

// Run synchronously before any component renders so every screen reads
// already-migrated data (avoids child-useEffect reading stale registry).
runMigrations();
// Start preloading all route chunks immediately — before React even renders —
// so by the time the user can tap anything, chunks are already cached.
preloadCriticalRoutes();

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <CartProvider>
          <AuditLogProvider>
            <RouterProvider router={router} fallbackElement={<PageLoader />} />
            <Toaster position="top-center" richColors closeButton />
          </AuditLogProvider>
        </CartProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}