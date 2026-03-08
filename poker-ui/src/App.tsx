/**
 * Main App component with routing
 */
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { WelcomeGatePage } from './pages/WelcomeGatePage';
import { WelcomeChipGatePage } from './pages/WelcomeChipGatePage';
import { WelcomeChipFlipGatePage } from './pages/WelcomeChipFlipGatePage';
import { WelcomeDealRevealPage } from './pages/WelcomeDealRevealPage';
import { DashboardPage } from './pages/DashboardPage';
import CommunityLobbyPage from './pages/CommunityLobbyPage';
import { GameTablePage } from './pages/GameTablePage';
import { MarketplacePage } from './pages/MarketplacePage';
import { SkinsPage } from './pages/SkinsPage';
import { MessagesPage } from './pages/MessagesPage';
import { TournamentsPage } from './pages/TournamentsPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { LearningPage } from './pages/LearningPage';
import { TutorialPage } from './pages/TutorialPage';
import RulesScrollHelp from './components/RulesScrollHelp';
import './App.css';

function AppRoutes() {
  const location = useLocation();
  const isInGame = location.pathname.startsWith('/game/');
  const hideGlobalFloatingUi = (
    location.pathname === '/'
    || location.pathname === '/chipspin'
    || location.pathname === '/chipflip'
    || location.pathname === '/dealreveal'
    || location.pathname === '/learningmode'
    || location.pathname === '/login'
    || location.pathname === '/register'
    || location.pathname === '/tutorial'
  );
  const showMenuRules = !isInGame && !hideGlobalFloatingUi;
  const showLearningButton = showMenuRules && location.pathname !== '/learning';

  return (
    <>
      <Routes>
        <Route path="/" element={<WelcomeDealRevealPage />} />
        <Route path="/chipspin" element={<WelcomeChipGatePage />} />
        <Route path="/chipflip" element={<WelcomeChipFlipGatePage />} />
        <Route path="/dealreveal" element={<WelcomeDealRevealPage />} />
        <Route path="/learningmode" element={<WelcomeGatePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/tutorial"
          element={
            <ProtectedRoute>
              <TutorialPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/community/:communityId"
          element={
            <ProtectedRoute>
              <CommunityLobbyPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/game/:tableId"
          element={
            <ProtectedRoute>
              <GameTablePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/marketplace"
          element={
            <ProtectedRoute>
              <MarketplacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/skins"
          element={
            <ProtectedRoute>
              <SkinsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <MessagesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tournaments"
          element={
            <ProtectedRoute>
              <TournamentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/feedback"
          element={
            <ProtectedRoute>
              <FeedbackPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learning"
          element={
            <ProtectedRoute>
              <LearningPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      {showLearningButton && (
        <Link
          to="/learning"
          state={{ from: `${location.pathname}${location.search}` }}
          className="learning-fab"
          aria-label="Open Learning Hub"
          title="Learning Hub"
        >
          📘
        </Link>
      )}
      {showMenuRules && <RulesScrollHelp variant="general" mode="floating" />}
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
