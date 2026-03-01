import { useEffect, useRef, useState } from 'react';
import './RulesScrollHelp.css';

type RulesVariant = 'general' | 'game';
type RulesMode = 'floating' | 'inline';

interface RulesScrollHelpProps {
  variant: RulesVariant;
  mode?: RulesMode;
  className?: string;
}

const HAND_RANKINGS = [
  'Royal Flush: A-K-Q-J-10, same suit',
  'Straight Flush: five in sequence, same suit',
  'Four of a Kind: four cards of the same rank',
  'Full House: three of a kind + one pair',
  'Flush: five cards of the same suit',
  'Straight: five in sequence, mixed suits',
  'Three of a Kind: three cards of the same rank',
  'Two Pair: two different pairs',
  'One Pair: one pair',
  'High Card: best single card plays',
];

const GENERAL_GUIDELINES = [
  'Leagues are top-level groups visible on the dashboard.',
  'Any user can create a league and becomes league owner/admin for that league.',
  'Users request to join leagues and communities; admins review those requests in inbox.',
  'League members can create communities in that league.',
  'Community admins manage community balances and member operations.',
  'Tables are created inside communities with blinds, buy-in, and seat limits.',
  'Any user can create tournaments in their own community. Non-community-owners use buy-in-percentage payout structures.',
  'Gold coins are universal marketplace currency and separate from table chips.',
  'Gold coin target peg: 1 gold coin is roughly equal to 1 US cent.',
  'Current coin packs: $1=100, $5=550, $10=1200, $50=6200, $100=12800.',
  'Community skin creators receive a 5% royalty tracked in USD cents for cash payouts.',
  'Table creators can configure table behavior (for example: bot allowance).',
];

export default function RulesScrollHelp({ variant, mode = 'inline', className = '' }: RulesScrollHelpProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`rules-scroll-help ${mode === 'floating' ? 'is-floating' : 'is-inline'} ${className}`}
    >
      <button
        type="button"
        className="rules-scroll-trigger"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={variant === 'game' ? 'Show hand rankings' : 'Show poker rules and app guide'}
        title={variant === 'game' ? 'Hand rankings' : 'Poker rules and app guide'}
      >
        📜
      </button>

      {open && (
        <div className={`rules-scroll-panel ${variant === 'game' ? 'game-variant' : 'general-variant'}`}>
          <div className="rules-scroll-header">
            <h3>{variant === 'game' ? 'Hand Rankings' : 'Poker Guide'}</h3>
            <button type="button" className="rules-scroll-close" onClick={() => setOpen(false)} aria-label="Close rules">
              ×
            </button>
          </div>

          {variant === 'game' ? (
            <>
              <div className="rules-scroll-note">Highest to lowest:</div>
              <ol className="rules-scroll-list">
                {HAND_RANKINGS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <div className="rules-scroll-note">Official references:</div>
              <ul className="rules-scroll-links">
                <li>
                  <a href="https://en.wikipedia.org/wiki/Texas_hold_%27em" target="_blank" rel="noreferrer">
                    Texas Hold'em (Wikipedia)
                  </a>
                </li>
                <li>
                  <a href="https://en.wikipedia.org/wiki/List_of_poker_hands" target="_blank" rel="noreferrer">
                    Poker Hand Rankings (Wikipedia)
                  </a>
                </li>
              </ul>

              <div className="rules-scroll-note">How this app works:</div>
              <ul className="rules-scroll-list">
                {GENERAL_GUIDELINES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
