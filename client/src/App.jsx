import { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { getHashPath, parseRoute, navigate } from './lib/navigation.js';
import Shell from './components/Shell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ReportFormPage from './pages/ReportFormPage.jsx';
import ReportDetailPage from './pages/ReportDetailPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminLogsPage from './pages/AdminLogsPage.jsx';
import AdminRefereesPage from './pages/AdminRefereesPage.jsx';
import RefereeDetailPage from './pages/RefereeDetailPage.jsx';
import RefereeHomePage from './pages/RefereeHomePage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import GamesPage from './pages/GamesPage.jsx';
import GameDetailPage from './pages/GameDetailPage.jsx';
import DesignateObserversPage from './pages/DesignateObserversPage.jsx';
import AdminSourcesPage from './pages/AdminSourcesPage.jsx';
import AdminImportsPage from './pages/AdminImportsPage.jsx';
import CoveragePage from './pages/CoveragePage.jsx';

function useRoute() {
  const [path, setPath] = useState(getHashPath());

  useEffect(() => {
    const handler = () => setPath(getHashPath());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return parseRoute(path);
}

export default function App() {
  const route = useRoute();
  const [user, setUser] = useState(null);
  const [features, setFeatures] = useState({ aiEnabled: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then((data) => {
        setUser(data.user);
        setFeatures(data.features || { aiEnabled: false });
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await api.logout();
    setUser(null);
    navigate('/');
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <img src="/app-logo.png" alt="" />
        </div>
        <p>Preparo il parquet...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const isReferee = user.role === 'referee';
  let page = isReferee
    ? <RefereeHomePage currentUser={user} />
    : <DashboardPage currentUser={user} />;
  if (route.name === 'refereeHome') page = <RefereeHomePage currentUser={user} />;
  if (!isReferee && route.name === 'games') page = <GamesPage currentUser={user} />;
  if (!isReferee && route.name === 'designateObservers') page = <DesignateObserversPage currentUser={user} />;
  if (!isReferee && route.name === 'gameDetail') page = <GameDetailPage id={route.id} currentUser={user} />;
  if (route.name === 'adminSources') page = <AdminSourcesPage currentUser={user} />;
  if (route.name === 'adminImports') page = <AdminImportsPage currentUser={user} />;
  if (!isReferee && route.name === 'coverage') page = <CoveragePage currentUser={user} />;
  if (!isReferee && route.name === 'newReport') page = <ReportFormPage currentUser={user} features={features} gameId={route.gameId} />;
  if (!isReferee && route.name === 'editReport') page = <ReportFormPage id={route.id} currentUser={user} features={features} />;
  if (route.name === 'reportDetail') page = <ReportDetailPage id={route.id} currentUser={user} />;
  if (route.name === 'account') page = (
    <AccountPage
      currentUser={user}
      onUserUpdated={setUser}
      onPasswordChanged={() => {
        setUser(null);
        navigate('/');
      }}
    />
  );
  if (route.name === 'adminLogs') page = <AdminLogsPage currentUser={user} />;
  if (route.name === 'adminRefereeDetail') page = <RefereeDetailPage id={route.id} currentUser={user} />;
  if (route.name === 'adminReferees') page = <AdminRefereesPage currentUser={user} />;
  if (route.name === 'adminUsers') page = <AdminUsersPage currentUser={user} onPasswordChanged={() => {
    setUser(null);
    navigate('/');
  }} />;
  if (route.name === 'notFound') {
    page = (
      <div className="empty-state">
        <h2>Pagina non trovata</h2>
        <button type="button" className="primary-button" onClick={() => navigate('/')}>Torna alla dashboard</button>
      </div>
    );
  }

  const showBackButton = route.name !== 'dashboard' && route.name !== 'refereeHome';

  return (
    <Shell user={user} onLogout={handleLogout} showBackButton={showBackButton}>
      {page}
    </Shell>
  );
}
