/**
 * Action Timer Component - Displays countdown for player's action
 */
import React, { useState, useEffect } from 'react';
import './ActionTimer.css';

interface ActionTimerProps {
  turnSeconds?: number;
  remainingTurnSeconds?: number;
  reserveSeconds?: number;
  isMyTurn: boolean;
}

export const ActionTimer: React.FC<ActionTimerProps> = ({ 
  turnSeconds,
  remainingTurnSeconds: initialTurnRemaining,
  reserveSeconds: initialReserveSeconds,
  isMyTurn 
}) => {
  const [remainingTurnSeconds, setRemainingTurnSeconds] = useState(initialTurnRemaining || 0);
  const [remainingReserveSeconds, setRemainingReserveSeconds] = useState(initialReserveSeconds || 0);

  useEffect(() => {
    setRemainingTurnSeconds(initialTurnRemaining || 0);
  }, [initialTurnRemaining]);

  useEffect(() => {
    setRemainingReserveSeconds(initialReserveSeconds || 0);
  }, [initialReserveSeconds]);

  useEffect(() => {
    if (!isMyTurn || (remainingTurnSeconds <= 0 && remainingReserveSeconds <= 0)) {
      return;
    }

    const interval = setInterval(() => {
      setRemainingTurnSeconds((previousTurn) => {
        if (previousTurn > 0) {
          return Math.max(0, previousTurn - 1);
        }

        setRemainingReserveSeconds((previousReserve) => Math.max(0, previousReserve - 1));
        return previousTurn;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isMyTurn, remainingTurnSeconds, remainingReserveSeconds]);

  if (!turnSeconds && !initialReserveSeconds) {
    return null;
  }

  const inReserve = remainingTurnSeconds <= 0 && isMyTurn;
  const percentage = inReserve
    ? (initialReserveSeconds && initialReserveSeconds > 0 ? (remainingReserveSeconds / initialReserveSeconds) * 100 : 0)
    : (turnSeconds && turnSeconds > 0 ? (remainingTurnSeconds / turnSeconds) * 100 : 0);

  const activeSeconds = inReserve ? remainingReserveSeconds : remainingTurnSeconds;
  const isUrgent = activeSeconds <= 5;
  const isWarning = activeSeconds <= 10 && !isUrgent;

  return (
    <div className={`action-timer ${isMyTurn ? 'active' : ''} ${isUrgent ? 'urgent' : isWarning ? 'warning' : ''}`}>
      <div className="timer-bar-container">
        <div 
          className="timer-bar" 
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="timer-text">
        {isMyTurn ? (
          <>
            <span className="timer-label">{inReserve ? 'Reserve:' : 'Your Turn:'}</span>
            <span className="timer-value">{Math.max(0, Math.ceil(activeSeconds))}s</span>
          </>
        ) : (
          <span className="timer-label">Waiting for other players...</span>
        )}
      </div>
    </div>
  );
};
