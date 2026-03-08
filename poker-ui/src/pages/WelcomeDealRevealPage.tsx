import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { hasSeenDormstacks, markDormstacksSeen, setPostSignupTutorialPending } from '../utils/visitorState';
import './WelcomeDealRevealPage.css';

const DEAL_REVEAL_ANIMATION_MS = 2600;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeInOutCubic = (value: number): number => {
  const x = clamp01(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const WelcomeDealRevealPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuth();
  const [checkedVisitorState, setCheckedVisitorState] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [started, setStarted] = useState(false);
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

  const startDealReveal = () => {
    if (started) {
      return;
    }

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setStarted(true);
    setShowChoices(false);
    setAnimationProgress(0);

    const animationStart = performance.now();
    const animate = (timestamp: number) => {
      const elapsed = timestamp - animationStart;
      const progress = clamp01(elapsed / DEAL_REVEAL_ANIMATION_MS);
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

  const handleCardClick = (side: 'left' | 'right') => {
    if (!started) {
      startDealReveal();
      return;
    }
    if (!showChoices) {
      return;
    }
    if (side === 'left') {
      goToRegister();
      return;
    }
    goToLogin();
  };

  if (!isReady || !checkedVisitorState) {
    return (
      <div className="welcome-deal-page">
        <div className="welcome-deal-loading">Loading DormStacks...</div>
      </div>
    );
  }

  if (!isFirstVisit) {
    return (
      <div className="welcome-deal-page">
        <div className="welcome-deal-loading">Opening DormStacks...</div>
      </div>
    );
  }

  const flipProgress = started ? easeInOutCubic(clamp01((animationProgress - 0.12) / 0.46)) : 0;
  const textProgress = started ? easeInOutCubic(clamp01((animationProgress - 0.72) / 0.28)) : 0;
  const cardFlipDeg = 180 * flipProgress;

  return (
    <div className="welcome-deal-page">
      <div className="welcome-deal-stage">
        <div className="welcome-deal-hand">
          <button
            type="button"
            className="deal-card-shell"
            onClick={() => handleCardClick('left')}
            aria-label={showChoices ? 'Create Account' : 'Reveal options card'}
            style={{
              transform: 'translateY(-6px) rotateZ(-8deg)',
            }}
          >
            <span className="deal-card-inner" style={{ transform: `rotateY(${cardFlipDeg}deg)` }}>
              <span className="deal-card-face back" />
              <span className="deal-card-face front">
                <span className="deal-card-title" style={{ opacity: textProgress }}>Create Account</span>
                <span className="deal-card-subtitle" style={{ opacity: textProgress }}>I don&apos;t have an account</span>
              </span>
            </span>
          </button>

          <button
            type="button"
            className="deal-card-shell"
            onClick={() => handleCardClick('right')}
            aria-label={showChoices ? 'Sign In' : 'Reveal options card'}
            style={{
              transform: 'rotateZ(8deg)',
            }}
          >
            <span className="deal-card-inner" style={{ transform: `rotateY(${-cardFlipDeg}deg)` }}>
              <span className="deal-card-face back deal-card-face-right-back" />
              <span className="deal-card-face front">
                <span className="deal-card-title" style={{ opacity: textProgress }}>Sign In</span>
                <span className="deal-card-subtitle" style={{ opacity: textProgress }}>I do have an account</span>
              </span>
            </span>
          </button>
        </div>

      </div>
    </div>
  );
};
