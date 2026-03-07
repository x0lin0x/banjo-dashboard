import { lazy } from 'react';
import MainLayout from 'layout/MainLayout';
import Loadable from 'ui-component/Loadable';

// Dashboard
const DashboardDefault = Loadable(lazy(() => import('views/dashboard/Default')));

// Test simple
const TestPage = Loadable(lazy(() => import('pages/trading/Test')));

const MainRoutes = {
  path: '/',
  element: <MainLayout />,
  children: [
    { path: '/', element: <DashboardDefault /> },
    { path: 'dashboard', children: [{ path: 'default', element: <DashboardDefault /> }] },
    { path: 'test', element: <TestPage /> }
  ]
};

export default MainRoutes;
