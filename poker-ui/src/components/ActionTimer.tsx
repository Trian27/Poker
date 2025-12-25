/**
 * Action Timer Component - Displays countdown for player's action
 */
import React, { useState, useEffect } from 'react';
import './ActionTimer.css';

interface ActionTimerProps {
  totalSeconds?: number;
  remainingSeconds?: number;
  isMyTurn: boolean;
}

export const ActionTimer: React.FC<ActionTimerProps> = ({ 
  totalSeconds, 
  remainingSeconds: initialRemaining, 
  isMyTurn 
}) => {
  const [remainingSeconds, setRemainingSeconds] = useState(initialRemaining || 0);

  useEffect(() => {
    // Update remaining time when prop changes
    setRemainingSeconds(initialRemaining || 0);
  }, [initialRemaining]);

  useEffect(() => {
    // Only count down if it's the player's turn and there's time remaining
    if (!isMyTurn || !totalSeconds || remainingSeconds <= 0) {
      return;
    }

    const interval = setInterval(() => {
      setRemainingSeconds(prev => {
        const next = prev - 1;
        return next >= 0 ? next : 0;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isMyTurn, totalSeconds, remainingSeconds]);

  // Don't render if no timeout configured
  if (!totalSeconds) {
    return null;
  }

  // Calculate percentage for visual indicator
  const percentage = totalSeconds > 0 ? (remainingSeconds / totalSeconds) * 100 : 0;

  // Determine warning level
  const isUrgent = remainingSeconds <= 5;
  const isWarning = remainingSeconds <= 10 && !isUrgent;

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
            <span className="timer-label">Your Turn:</span>
            <span className="timer-value">{remainingSeconds}s</span>
          </>
        ) : (
          <span className="timer-label">Waiting for other players...</span>
        )}
      </div>
    </div>
  );
};
