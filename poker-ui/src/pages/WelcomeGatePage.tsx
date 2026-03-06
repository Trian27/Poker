import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { hasSeenDormstacks, markDormstacksSeen, setPostSignupTutorialPending } from '../utils/visitorState';
import './WelcomeGatePage.css';

const BOOK_OPEN_ANIMATION_MS = 1650;
const CLOSED_BOOK_ANCHOR_X = 56;
const OPEN_BOOK_ANCHOR_X = 50;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeInOutCubic = (value: number): number => {
  const x = clamp01(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const WelcomeGatePage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuth();
  const [checkedVisitorState, setCheckedVisitorState] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [bookOpened, setBookOpened] = useState(false);
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

  const handleOpenBook = () => {
    if (bookOpened) {
      return;
    }
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setBookOpened(true);
    setShowChoices(false);
    setAnimationProgress(0);

    const animationStart = performance.now();
    const animate = (timestamp: number) => {
      const elapsed = timestamp - animationStart;
      const progress = clamp01(elapsed / BOOK_OPEN_ANIMATION_MS);
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
      <div className="welcome-gate-page">
        <div className="welcome-gate-loading">Loading DormStacks...</div>
      </div>
    );
  }

  if (!isFirstVisit) {
    return (
      <div className="welcome-gate-page">
        <div className="welcome-gate-loading">Opening DormStacks...</div>
      </div>
    );
  }

  const moveProgress = bookOpened ? easeInOutCubic(clamp01(animationProgress / 0.42)) : 0;
  const currentAnchorX = CLOSED_BOOK_ANCHOR_X + (OPEN_BOOK_ANCHOR_X - CLOSED_BOOK_ANCHOR_X) * moveProgress;
  const coverOpenProgress = bookOpened ? easeInOutCubic(clamp01((animationProgress - 0.06) / 0.54)) : 0;
  const coverOpacity = showChoices ? 0 : 1 - clamp01((animationProgress - 0.82) / 0.18);
  const openBookProgress = bookOpened ? easeInOutCubic(clamp01((animationProgress - 0.2) / 0.28)) : 0;
  const openBookScale = 0.985 + openBookProgress * 0.015;
  const choiceTextOpacity = showChoices ? 1 : clamp01((animationProgress - 0.88) / 0.12);

  return (
    <div className="welcome-gate-page">
      <div className="welcome-gate-inner">
        <div className="welcome-book-stage">
          <div
            className="welcome-book-frame"
            style={{ '--book-anchor-x': `${currentAnchorX}%` } as React.CSSProperties}
          >
            <div
              className="welcome-open-book"
              aria-label="DormStacks onboarding choices"
              style={{
                opacity: openBookProgress,
                visibility: openBookProgress > 0 ? 'visible' : 'hidden',
                pointerEvents: showChoices ? 'auto' : 'none',
                transform: `translate(-50%, -50%) scale(${openBookScale})`,
              }}
            >
              <button
                type="button"
                className="welcome-book-page option left"
                onClick={goToRegister}
              >
                <span className="welcome-page-content" style={{ opacity: choiceTextOpacity }}>
                  <span className="page-eyebrow">I don&apos;t have an account</span>
                  <span className="page-title">Create Account</span>
                  <span className="page-copy">
                    Start your account and continue into the tutorial flow.
                  </span>
                </span>
              </button>
              <div className="welcome-book-spine" aria-hidden="true" />
              <button
                type="button"
                className="welcome-book-page option right"
                onClick={goToLogin}
              >
                <span className="welcome-page-content" style={{ opacity: choiceTextOpacity }}>
                  <span className="page-eyebrow">I do have an account</span>
                  <span className="page-title">Sign In</span>
                  <span className="page-copy">
                    Go to login and continue directly to your dashboard.
                  </span>
                </span>
              </button>
            </div>

            {bookOpened && !showChoices && animationProgress < 0.99 && (
              <div className="welcome-page-flip-stack" aria-hidden="true">
                {[0, 1, 2].map((sheetIndex) => {
                  const flipWindowProgress = clamp01((animationProgress - 0.2) / 0.66);
                  const start = sheetIndex * 0.15;
                  const duration = 0.58;
                  const localProgress = clamp01((flipWindowProgress - start) / duration);
                  const eased = easeInOutCubic(localProgress);
                  const translateX = -100 * eased;
                  const rotateY = -180 * eased;
                  const stackOffset = sheetIndex * 6 * eased;
                  const opacity = localProgress === 0 ? 0 : 0.56 + (2 - sheetIndex) * 0.08;

                  return (
                    <span
                      key={sheetIndex}
                      className={`flip-sheet sheet-${sheetIndex + 1}`}
                      style={{
                        transform: `translateX(calc(${translateX}% - ${stackOffset}px)) rotateY(${rotateY}deg)`,
                        opacity,
                      }}
                    />
                  );
                })}
              </div>
            )}

            <button
              type="button"
              className="welcome-book-cover"
              onClick={handleOpenBook}
              aria-label="Open DormStacks onboarding book"
              disabled={bookOpened}
              style={{
                transform: `translate(-50%, -50%) rotateY(${-122 * coverOpenProgress}deg)`,
                opacity: coverOpacity,
              }}
            >
              <img src="/assets/brand-book-embossed.svg" alt="" className="welcome-book-cover-image" />
              <span className="welcome-book-cover-title">DormStacks</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
