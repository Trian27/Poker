import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { hasSeenDormstacks, markDormstacksSeen, setPostSignupTutorialPending } from '../utils/visitorState';
import './WelcomeChipFlipGatePage.css';

const CHIP_FLIP_ANIMATION_MS = 3600;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeInOutCubic = (value: number): number => {
  const x = clamp01(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const WelcomeChipFlipGatePage: React.FC = () => {
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

  const handleFlipOpen = () => {
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
      const progress = clamp01(elapsed / CHIP_FLIP_ANIMATION_MS);
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
      <div className="welcome-chipflip-page">
        <div className="welcome-chipflip-loading">Loading DormStacks...</div>
      </div>
    );
  }

  if (!isFirstVisit) {
    return (
      <div className="welcome-chipflip-page">
        <div className="welcome-chipflip-loading">Opening DormStacks...</div>
      </div>
    );
  }

  const flipProgress = chipOpened ? easeInOutCubic(clamp01((animationProgress - 0.08) / 0.66)) : 0;
  const revealProgress = chipOpened ? easeInOutCubic(clamp01((animationProgress - 0.86) / 0.14)) : 0;
  const overlayOpacity = 1 - clamp01((animationProgress - 0.78) / 0.22);
  const centerBadgeOpacity = 1 - clamp01((animationProgress - 0.68) / 0.2);
  const innerCoreOpacity = 1 - clamp01((animationProgress - 0.74) / 0.2);

  const flipXDeg = 360 * flipProgress;
  const flipYDeg = 14 * Math.sin(flipProgress * Math.PI);

  return (
    <div className="welcome-chipflip-page">
      <div className="welcome-chipflip-stage">
        <div className="welcome-chipflip-shell" aria-label="DormStacks chip-flip first-visit entry">
          <div
            className="chipflip-option-panels"
            style={{
              opacity: revealProgress,
              transform: 'scale(1)',
              pointerEvents: showChoices ? 'auto' : 'none',
            }}
          >
            <button type="button" className="chipflip-option-panel left" onClick={goToRegister} disabled={!showChoices}>
              <span className="chipflip-option-title">Create Account</span>
              <span className="chipflip-option-subtitle">I don&apos;t have an account</span>
            </button>
            <button type="button" className="chipflip-option-panel right" onClick={goToLogin} disabled={!showChoices}>
              <span className="chipflip-option-title">Sign In</span>
              <span className="chipflip-option-subtitle">I do have an account</span>
            </button>
          </div>

          <div
            className="chipflip-overlay"
            style={{
              opacity: overlayOpacity,
              transform: `translateZ(0) rotateX(${flipXDeg}deg) rotateY(${flipYDeg}deg)`,
            }}
          >
            <span className="chipflip-rim" />
            <span className="chipflip-half left" />
            <span className="chipflip-half right" />
            <span className="chipflip-inner-core" style={{ opacity: innerCoreOpacity }} />
            <span className="chipflip-center-badge" style={{ opacity: centerBadgeOpacity }}>
              DormStacks
            </span>
          </div>

          {!chipOpened && (
            <button
              type="button"
              className="chipflip-unlock-hit-area"
              onClick={handleFlipOpen}
              aria-label="Flip open DormStacks chip"
            />
          )}
        </div>

        <div className="welcome-chipflip-links">
          <Link to="/chipspin" className="welcome-chipflip-link">
            Prefer spin reveal? Open `/chipspin`.
          </Link>
          <Link to="/dealreveal" className="welcome-chipflip-link">
            Try card deal reveal at `/dealreveal`.
          </Link>
          <Link to="/learningmode" className="welcome-chipflip-link">
            Prefer book onboarding? Open `/learningmode`.
          </Link>
        </div>
      </div>
    </div>
  );
};
