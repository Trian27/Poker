import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

type ChipProps = {
  cx: number;
  cy: number;
  r?: number;
};

const CoverChip: React.FC<ChipProps> = ({ cx, cy, r = 11 }) => (
  <g transform={`translate(${cx} ${cy})`}>
    <circle r={r} fill="#e5cc87" stroke="#a78945" strokeWidth="1.3" />
    <circle r={r * 0.58} fill="none" stroke="#0f4c3d" strokeWidth="2.1" />
    {[0, 60, 120, 180, 240, 300].map((angle) => (
      <rect
        key={angle}
        x={-1.1}
        y={-r}
        width={2.2}
        height={4.2}
        rx={0.8}
        fill="#0f4c3d"
        transform={`rotate(${angle})`}
      />
    ))}
  </g>
);

type CardProps = {
  x: number;
  y: number;
  rotate: number;
  label: string;
};

const CoverCard: React.FC<CardProps> = ({ x, y, rotate, label }) => (
  <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <rect
      x={-18}
      y={-30}
      width={36}
      height={56}
      rx={4}
      fill="#124f41"
      stroke="#d5b46b"
      strokeWidth="2"
    />
    <text
      x={-10}
      y={-14}
      fill="#d5b46b"
      fontSize="8.2"
      fontFamily="Georgia, 'Times New Roman', serif"
      fontWeight={700}
    >
      {label}
    </text>
    <path d="M 0 2 C -4 -3 -8 -2 -8 2 C -8 7 -2 9 0 14 C 2 9 8 7 8 2 C 8 -2 4 -3 0 2 Z" fill="#d5b46b" />
  </g>
);

const ProgrammaticBookCoverArt: React.FC = () => (
  <svg
    viewBox="0 0 2750 4000"
    className="welcome-book-cover-art"
    role="img"
    aria-label="DormStacks embossed green book cover"
    shapeRendering="geometricPrecision"
    textRendering="geometricPrecision"
    preserveAspectRatio="none"
  >
    <defs>
      <linearGradient id="coverFeltGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#1f7863" />
        <stop offset="48%" stopColor="#155a4b" />
        <stop offset="100%" stopColor="#0f4339" />
      </linearGradient>
      <linearGradient id="coverSpineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#0d3d33" />
        <stop offset="100%" stopColor="#1a6653" />
      </linearGradient>
      <linearGradient id="coverGoldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f2e0ae" />
        <stop offset="100%" stopColor="#b58e4a" />
      </linearGradient>
    </defs>
    <g transform="scale(12.5)">
      <rect x="0" y="0" width="220" height="320" rx="10" fill="url(#coverFeltGradient)" />
      <rect x="0" y="0" width="20" height="320" rx="10" fill="url(#coverSpineGradient)" opacity="0.92" />
      <rect x="20" y="20" width="176" height="280" rx="4" fill="none" stroke="#0f4c3d" strokeWidth="2" opacity="0.72" />
      <rect x="26" y="28" width="164" height="264" rx="2" fill="none" stroke="#0b3f34" strokeWidth="1.2" opacity="0.64" />

      <path
        d="M 36 38 C 52 38, 58 46, 66 52 M 184 38 C 168 38, 162 46, 154 52 M 36 282 C 52 282, 58 274, 66 268 M 184 282 C 168 282, 162 274, 154 268"
        stroke="#0b3f34"
        strokeWidth="2.4"
        fill="none"
        opacity="0.58"
      />

      <CoverChip cx={78} cy={92} />
      <CoverChip cx={110} cy={92} />
      <CoverChip cx={142} cy={92} />

      <text
        x="113"
        y="160"
        fill="url(#coverGoldGradient)"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight={700}
        fontSize="21"
        textAnchor="middle"
        textLength="154"
        lengthAdjust="spacingAndGlyphs"
      >
        DORMSTACKS
      </text>

      <CoverCard x={74} y={242} rotate={-28} label="A" />
      <CoverCard x={92} y={236} rotate={-16} label="K" />
      <CoverCard x={110} y={232} rotate={-5} label="Q" />
      <CoverCard x={128} y={236} rotate={8} label="J" />
      <CoverCard x={146} y={244} rotate={22} label="10" />
    </g>
  </svg>
);

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
              <ProgrammaticBookCoverArt />
            </button>
          </div>
        </div>
        <div className="welcome-book-links">
          <Link to="/chipspin" className="welcome-book-link">Try chip spin at `/chipspin`</Link>
          <Link to="/chipflip" className="welcome-book-link">Try chip flip at `/chipflip`</Link>
          <Link to="/dealreveal" className="welcome-book-link">Try card deal at `/dealreveal`</Link>
        </div>
      </div>
    </div>
  );
};
