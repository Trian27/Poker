/**
 * Game Table page - real-time poker game interface with chat and reconnection
 */
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../AuthContext';
import { ActionTimer } from '../components/ActionTimer';
import type { GameState, GameAction, Card, ChatMessage } from '../types';
import './GameTable.css';

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3000';

export const GameTablePage: React.FC = () => {
  const { communityId } = useParams<{ communityId: string }>();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState('');
  const [betAmount, setBetAmount] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const { user, token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !communityId) return;

    // Connect to game server with JWT token
    const newSocket = io(GAME_SERVER_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('Connected to game server');
      setConnected(true);
      setReconnecting(false);
      setError('');
      
      // Join the game for this community
      newSocket.emit('join_game', { communityId: parseInt(communityId) });
    });

    newSocket.on('connect_error', (err) => {
      console.error('Connection error:', err);
      setError('Failed to connect to game server');
      setConnected(false);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from game server');
      setConnected(false);
      setReconnecting(true);
    });

    newSocket.on('reconnected', ({ message, gameState: restoredState }: { message: string; gameState: GameState }) => {
      console.log('Reconnected:', message);
      setGameState(restoredState);
      setReconnecting(false);
      setError('');
    });

    newSocket.on('player_disconnected', ({ playerName }: { playerName: string }) => {
      console.log(`Player disconnected: ${playerName}`);
      // Could show a notification
    });

    newSocket.on('player_reconnected', ({ playerName }: { playerName: string }) => {
      console.log(`Player reconnected: ${playerName}`);
      // Could show a notification
    });

    newSocket.on('game_state_update', ({ gameState: newGameState }: { gameState: GameState }) => {
      console.log('Game state update:', newGameState);
      setGameState(newGameState);
    });

    newSocket.on('player_timeout', ({ playerId: _playerId, playerName }: { playerId: string; playerName: string }) => {
      console.log(`Player timed out: ${playerName}`);
      // Show notification (optional)
      setError(`${playerName} timed out - auto-folded/checked`);
      setTimeout(() => setError(''), 3000);
    });

    newSocket.on('chat_message', (message: ChatMessage) => {
      console.log('Chat message:', message);
      setChatMessages(prev => [...prev, message]);
    });

    newSocket.on('chat_history', ({ messages }: { messages: ChatMessage[] }) => {
      console.log('Chat history loaded:', messages.length);
      setChatMessages(messages);
    });

    newSocket.on('error', ({ message }: { message: string }) => {
      setError(message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token, communityId]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendAction = (gameAction: GameAction) => {
    if (!socket || !connected) {
      setError('Not connected to game server');
      return;
    }

    socket.emit('game_action', gameAction);
    setBetAmount(''); // Clear bet amount after action
  };

  const sendChatMessage = () => {
    if (!socket || !connected || !chatInput.trim()) return;

    socket.emit('chat_message', {
      message: chatInput.trim(),
      gameId: gameState?.gameId
    });

    setChatInput('');
  };

  const handleFold = () => sendAction({ action: 'fold' });
  const handleCheck = () => sendAction({ action: 'check' });
  const handleCall = () => sendAction({ action: 'call' });
  const handleBet = () => {
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid bet amount');
      return;
    }
    sendAction({ action: 'bet', amount });
  };
  const handleRaise = () => {
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid raise amount');
      return;
    }
    sendAction({ action: 'raise', amount });
  };
  const handleAllIn = () => sendAction({ action: 'all-in' });

  const handleLeaveGame = () => {
    if (socket) {
      socket.emit('leave_game');
      socket.close();
    }
    navigate('/dashboard');
  };

  const renderCard = (card: Card, index: number) => {
    const suitSymbols: { [key: string]: string } = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠',
    };
    
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    
    return (
      <div key={index} className={`card ${isRed ? 'red' : 'black'}`}>
        <div className="card-rank">{card.rank}</div>
        <div className="card-suit">{suitSymbols[card.suit] || card.suit}</div>
      </div>
    );
  };

  const getCurrentPlayer = () => {
    if (!gameState || !user) return null;
    return gameState.players.find(p => p.id === user.id);
  };

  const isMyTurn = () => {
    const currentPlayer = getCurrentPlayer();
    return gameState?.currentTurnPlayerId === currentPlayer?.id;
  };

  const canCheck = () => {
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer || !gameState) return false;
    
    // Can check if current bet equals the highest bet
    const highestBet = Math.max(...gameState.players.map(p => p.currentBet));
    return currentPlayer.currentBet === highestBet;
  };

  if (!connected) {
    return (
      <div className="game-container">
        <div className="connecting-overlay">
          <div className="spinner"></div>
          <p>Connecting to game server...</p>
          {error && <p className="error">{error}</p>}
          <button onClick={handleLeaveGame} className="btn-secondary">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="game-container">
        <div className="waiting-overlay">
          <h2>Waiting for game to start...</h2>
          <p>Please wait while other players join.</p>
          <button onClick={handleLeaveGame} className="btn-secondary">
            Leave Game
          </button>
        </div>
      </div>
    );
  }

  const currentPlayer = getCurrentPlayer();

  return (
    <div className="game-container">
      <div className="game-header">
        <h2>🃏 Poker Game</h2>
        <div className="game-info">
          <span>Phase: {gameState.phase}</span>
          <span>Pot: ${gameState.pot}</span>
          <span>Min Bet: ${gameState.minBet}</span>
        </div>
        <button onClick={handleLeaveGame} className="btn-leave">
          Leave
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="game-table">
        {/* Community Cards */}
        <div className="community-cards">
          <h3>Community Cards</h3>
          <div className="cards-container">
            {gameState.communityCards.length > 0 ? (
              gameState.communityCards.map((card, index) => renderCard(card, index))
            ) : (
              <div className="no-cards">No cards yet</div>
            )}
          </div>
        </div>

        {/* Pot Display */}
        <div className="pot-display">
          <div className="pot-amount">${gameState.pot}</div>
          <div className="pot-label">Pot</div>
        </div>

        {/* Players */}
        <div className="players-container">
          {gameState.players.map((player) => (
            <div
              key={player.id}
              className={`player-card ${player.id === currentPlayer?.id ? 'current-user' : ''} ${
                player.hasFolded ? 'folded' : ''
              } ${gameState.currentTurnPlayerId === player.id ? 'active-turn' : ''}`}
            >
              <div className="player-info">
                <h4>{player.username}</h4>
                <p className="player-stack">Stack: ${player.stack}</p>
                <p className="player-bet">Bet: ${player.currentBet}</p>
                {player.isAllIn && <span className="badge">ALL IN</span>}
                {player.hasFolded && <span className="badge folded">FOLDED</span>}
                {gameState.currentTurnPlayerId === player.id && (
                  <span className="badge active">TURN</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Player's Hand */}
      {currentPlayer?.hand && currentPlayer.hand.length > 0 && (
        <div className="player-hand">
          <h3>Your Hand</h3>
          <div className="cards-container">
            {currentPlayer.hand.map((card, index) => renderCard(card, index))}
          </div>
        </div>
      )}

      {/* Action Timer */}
      <ActionTimer 
        totalSeconds={gameState.actionTimeoutSeconds}
        remainingSeconds={gameState.remainingActionTime}
        isMyTurn={isMyTurn()}
      />

      {/* Action Buttons */}
      {isMyTurn() && !currentPlayer?.hasFolded && (
        <div className="action-panel">
          <h3>Your Turn</h3>
          
          <div className="action-buttons">
            <button onClick={handleFold} className="btn-action btn-fold">
              Fold
            </button>
            
            {canCheck() && (
              <button onClick={handleCheck} className="btn-action btn-check">
                Check
              </button>
            )}
            
            {!canCheck() && (
              <button onClick={handleCall} className="btn-action btn-call">
                Call ${Math.max(...gameState.players.map(p => p.currentBet))}
              </button>
            )}
            
            <div className="bet-group">
              <input
                type="number"
                placeholder="Amount"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                min={gameState.minBet}
                className="bet-input"
              />
              <button onClick={handleBet} className="btn-action btn-bet">
                Bet
              </button>
              <button onClick={handleRaise} className="btn-action btn-raise">
                Raise
              </button>
            </div>
            
            <button onClick={handleAllIn} className="btn-action btn-allin">
              All In
            </button>
          </div>
        </div>
      )}

      {!isMyTurn() && !currentPlayer?.hasFolded && (
        <div className="waiting-turn">
          <p>Waiting for other players...</p>
        </div>
      )}

      {currentPlayer?.hasFolded && (
        <div className="folded-message">
          <p>You have folded. Waiting for hand to finish...</p>
        </div>
      )}

      {/* Chat Panel */}
      <div className="chat-panel">
        <div className="chat-header">
          <h4>💬 Chat</h4>
        </div>
        <div className="chat-messages">
          {chatMessages.length === 0 ? (
            <div className="no-messages">No messages yet. Say hello!</div>
          ) : (
            chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-message ${msg.userId === user?.id ? 'own-message' : ''}`}
              >
                <div className="message-header">
                  <span className="message-username">{msg.username}</span>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className="message-text">{msg.message}</div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input-container">
          <input
            type="text"
            placeholder="Type a message..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                sendChatMessage();
              }
            }}
            className="chat-input"
            maxLength={200}
          />
          <button onClick={sendChatMessage} className="btn-send-chat">
            Send
          </button>
        </div>
      </div>

      {/* Reconnection Overlay */}
      {reconnecting && (
        <div className="reconnecting-overlay">
          <div className="spinner"></div>
          <p>Reconnecting to game...</p>
        </div>
      )}
    </div>
  );
};
