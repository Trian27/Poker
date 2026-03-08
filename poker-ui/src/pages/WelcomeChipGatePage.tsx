import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { hasSeenDormstacks, markDormstacksSeen, setPostSignupTutorialPending } from '../utils/visitorState';
import './WelcomeChipGatePage.css';

const CHIP_OPEN_ANIMATION_MS = 2600;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeInOutCubic = (value: number): number => {
  const x = clamp01(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const WelcomeChipGatePage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuth();
  const [checkedVisitorState, setCheckedVisitorState] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [chipOpened, setChipOpened] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const seenBefore = hasSeenDormstacks();
    setIsFirstVisit(!seenBefore);
    setCheckedVisitorState(true);
  }, []);

  useEffect(() => {
    if (!isReady || !checkedVisitorState) {
      return;
    }

    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!isFirstVisit) {
      navigate('/login', { replace: true });
    }
  }, [checkedVisitorState, isAuthenticated, isFirstVisit, isReady, navigate]);

  const handleUnlock = () => {
    if (chipOpened) {
      return;
    }

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setChipOpened(true);
    setShowChoices(false);
    setAnimationProgress(0);

    const animationStart = performance.now();
    const animate = (timestamp: number) => {
      const elapsed = timestamp - animationStart;
      const progress = clamp01(elapsed / CHIP_OPEN_ANIMATION_MS);
      setAnimationProgress(progress);

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        setShowChoices(true);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);
  };

  const goToRegister = () => {
    markDormstacksSeen();
    setPostSignupTutorialPending(true);
    navigate('/register', { replace: true });
  };

  const goToLogin = () => {
    markDormstacksSeen();
    setPostSignupTutorialPending(false);
    navigate('/login', { replace: true });
  };

  if (!isReady || !checkedVisitorState) {
    return (
      <div className="welcome-chip-gate-page">
        <div className="welcome-chip-loading">Loading DormStacks...</div>
      </div>
    );
  }

  if (!isFirstVisit) {
    return (
      <div className="welcome-chip-gate-page">
        <div className="welcome-chip-loading">Opening DormStacks...</div>
      </div>
    );
  }

  const spinProgress = chipOpened ? easeInOutCubic(clamp01(animationProgress / 0.68)) : 0;
  const halfFadeProgress = chipOpened ? easeInOutCubic(clamp01((animationProgress - 0.5) / 0.34)) : 0;
  const panelRevealProgress = chipOpened ? easeInOutCubic(clamp01((animationProgress - 0.6) / 0.32)) : 0;

  const ringRotationDeg = 540 * spinProgress;
  const centerBadgeOpacity = 1 - clamp01((animationProgress - 0.5) / 0.22);
  const innerCoreOpacity = 1 - clamp01((animationProgress - 0.56) / 0.3);
  const halfOverlayOpacity = 1 - halfFadeProgress;

  return (
    <div className="welcome-chip-gate-page">
      <div className="welcome-chip-stage">
        <div className="welcome-chip-shell" aria-label="DormStacks first-visit entry">
          <div
            className="chip-option-panels"
            style={{
              opacity: panelRevealProgress,
              transform: 'scale(1)',
              pointerEvents: showChoices ? 'auto' : 'none',
            }}
          >
            <button type="button" className="chip-option-panel left" onClick={goToRegister} disabled={!showChoices}>
              <span className="chip-option-title">Create Account</span>
              <span className="chip-option-subtitle">I don&apos;t have an account</span>
            </button>
            <button type="button" className="chip-option-panel right" onClick={goToLogin} disabled={!showChoices}>
              <span className="chip-option-title">Sign In</span>
              <span className="chip-option-subtitle">I do have an account</span>
            </button>
          </div>

          <div className="chip-shield">
            <span className="chip-rim" style={{ transform: `rotate(${ringRotationDeg}deg)` }} />
            <span className="chip-half left" style={{ opacity: halfOverlayOpacity }} />
            <span className="chip-half right" style={{ opacity: halfOverlayOpacity }} />
            <span
              className="chip-inner-core"
              style={{
                opacity: innerCoreOpacity,
                transform: 'translate(-50%, -50%)',
              }}
            />
            <span className="chip-center-badge" style={{ opacity: centerBadgeOpacity }}>
              DormStacks
            </span>
            {!chipOpened && (
              <button
                type="button"
                className="chip-unlock-hit-area"
                onClick={handleUnlock}
                aria-label="Unlock DormStacks chip entry"
              />
            )}
          </div>
        </div>

        <Link to="/learningmode" className="welcome-learningmode-link">
          Prefer the book onboarding? Open `/learningmode`.
        </Link>
        <Link to="/chipflip" className="welcome-learningmode-link">
          Try the flip-chip onboarding at `/chipflip`.
        </Link>
        <Link to="/dealreveal" className="welcome-learningmode-link">
          Try card deal reveal at `/dealreveal`.
        </Link>
      </div>
    </div>
  );
};
