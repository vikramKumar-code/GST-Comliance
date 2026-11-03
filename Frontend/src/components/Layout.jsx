import MainLayout from './layout/MainLayout';

/**
 * Re-export MainLayout for 100% backward compatibility with all existing imports
 */
export default function Layout({ children }) {
  return <MainLayout>{children}</MainLayout>;
}
