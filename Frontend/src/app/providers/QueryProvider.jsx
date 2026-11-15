import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 15, // 15 minutes cache freshness (prevents redundant API refetching)
      gcTime: 1000 * 60 * 30,   // 30 minutes in memory
      retry: (failureCount, error) => {
        // Do not retry authorization or not-found errors
        if (error?.status === 401 || error?.status === 403 || error?.status === 404 || error?.code === 'SESSION_EXPIRED') {
          return false;
        }
        return failureCount < 1; // Limit to 1 retry to save API hits on provider failure
      },
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
