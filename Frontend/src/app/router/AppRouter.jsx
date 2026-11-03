import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '../../components/guards/ProtectedRoute';
import Layout from '../../components/Layout';
import Loader from '../../components/common/Loader';
import {
  publicRoutes,
  protectedRoutes,
  redirectRoutes,
  fallbackRoute,
} from './routeConfig';

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-8">
      <Loader message="Loading view..." />
    </div>
  );
}

/**
 * Clean composable AppRouter rendering declarative lazy routes
 */
export default function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public Marketing & Legal Pages */}
        {publicRoutes.map(({ path, element }) => (
          <Route key={path} path={path} element={element} />
        ))}

        {/* Protected Business & Compliance Routes */}
        {protectedRoutes.map(({ path, element }) => (
          <Route
            key={path}
            path={path}
            element={
              <ProtectedRoute>
                <Layout>{element}</Layout>
              </ProtectedRoute>
            }
          />
        ))}

        {/* Backward Compatibility Redirects */}
        {redirectRoutes.map(({ path, to }) => (
          <Route
            key={path}
            path={path}
            element={<Navigate to={to} replace />}
          />
        ))}

        {/* 404 Catch-All */}
        <Route path={fallbackRoute.path} element={fallbackRoute.element} />
      </Routes>
    </Suspense>
  );
}
