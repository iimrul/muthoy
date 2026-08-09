import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react({
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-router',
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          // Core daily-use screens travel together — one fetch covers all four.
          "core-pos": [
            "./src/app/screens/MorningDashboard.tsx",
            "./src/app/screens/SaleEntry.tsx",
            "./src/app/screens/Checkout.tsx",
            "./src/app/screens/Inventory.tsx",
          ],
          // Credit + customer detail share a chunk.
          "credit": [
            "./src/app/screens/CreditSales.tsx",
            "./src/app/screens/CustomerCreditDetail.tsx",
          ],
          // Secondary management screens — fetched on demand.
          "secondary": [
            "./src/app/screens/Suppliers.tsx",
            "./src/app/screens/SupplierInvoices.tsx",
            "./src/app/screens/ExpenseTracking.tsx",
            "./src/app/screens/MonthlyReport.tsx",
          ],
          // Vendor libs — cached separately, never re-downloaded.
          "vendor": ["react", "react-dom", "react-router"],
        },
      },
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
