import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 15, // 15 minutes cache freshness (prevents redundant API refetching)
      gcTime: 1000 * 60 * 30,   // 30 minutes in memory
      retry: false,              // Disable automatic retries to avoid burning paid GSP/TaxPro API credits
      refetchOnWindowFocus: false,
    },
  },
});

export default function QueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
